import { paddleApiBase, type PaddleEnvironment, type PaddleEvent } from './billing';

const PADDLE_REQUEST_TIMEOUT_MS = 15_000;
const CUSTOMER_PORTAL_HOSTS: Record<PaddleEnvironment, ReadonlySet<string>> = {
  sandbox: new Set(['sandbox-customer-portal.paddle.com', 'sandbox-buyer-portal.paddle.com']),
  production: new Set(['customer-portal.paddle.com', 'buyer-portal.paddle.com']),
};

export type ProrationBillingMode = 'prorated_immediately' | 'prorated_next_billing_period';

export interface BillingMoney {
  /** Amount in the currency's lowest denomination, e.g. cents for USD. */
  amount: string;
  currencyCode: string;
}

export interface SubscriptionChangePreview {
  immediateCharge: BillingMoney | null;
  nextCharge: BillingMoney | null;
  recurringCharge: BillingMoney | null;
}

export interface SubscriptionChangeArgs {
  subscriptionId: string;
  targetPriceId: string;
  managedPriceIds: readonly string[];
  prorationBillingMode: ProrationBillingMode;
}

export interface PaddleBillingOperations {
  createPortalSession(args: {
    customerId: string;
    subscriptionIds: readonly string[];
  }): Promise<string>;
  previewSubscriptionChange(args: SubscriptionChangeArgs): Promise<SubscriptionChangePreview>;
  applySubscriptionChange(args: SubscriptionChangeArgs): Promise<void>;
}

export interface PaddleBillingSnapshot {
  customers: PaddleEvent[];
  subscriptions: PaddleEvent[];
}

/** Read-only Paddle state used by the operator reconciliation action (#322). */
export interface PaddleBillingReader {
  fetchBillingSnapshot(args: {
    email: string;
    knownCustomerIds: readonly string[];
  }): Promise<PaddleBillingSnapshot>;
}

export type PaddleBillingErrorCode =
  | 'already_current'
  | 'managed_price_mismatch'
  | 'invalid_response'
  | 'paddle_unavailable';

export class PaddleBillingError extends Error {
  constructor(
    readonly code: PaddleBillingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaddleBillingError';
  }
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function requiredString(record: JsonRecord, key: string, entity: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new PaddleBillingError('invalid_response', `Paddle ${entity} response omitted ${key}`);
  }
  return value;
}

function requiredTimestamp(record: JsonRecord, key: string, entity: string): string {
  const value = requiredString(record, key, entity);
  if (Number.isNaN(Date.parse(value))) {
    throw new PaddleBillingError('invalid_response', `Paddle ${entity} returned an invalid ${key}`);
  }
  return value;
}

function customerEvent(value: unknown): PaddleEvent {
  const customer = asRecord(value);
  if (!customer) {
    throw new PaddleBillingError('invalid_response', 'Paddle returned an invalid customer');
  }
  return {
    event_type: 'customer.updated',
    occurred_at: requiredTimestamp(customer, 'updated_at', 'customer'),
    data: {
      id: requiredString(customer, 'id', 'customer'),
      email: requiredString(customer, 'email', 'customer'),
    },
  };
}

function subscriptionEvent(value: unknown): PaddleEvent {
  const subscription = asRecord(value);
  if (!subscription) {
    throw new PaddleBillingError('invalid_response', 'Paddle returned an invalid subscription');
  }
  const rawCustomData = asRecord(subscription.custom_data);
  const lectorUserId = rawCustomData?.lectorUserId;
  const currentBillingPeriod = asRecord(subscription.current_billing_period);
  const rawItems = subscription.items;
  if (!Array.isArray(rawItems)) {
    throw new PaddleBillingError('invalid_response', 'Paddle subscription response omitted items');
  }
  if (rawItems.length === 0) {
    throw new PaddleBillingError(
      'invalid_response',
      'Paddle subscription response returned no items',
    );
  }
  const items = rawItems.map((rawItem) => {
    const priceId = asRecord(asRecord(rawItem)?.price)?.id;
    if (typeof priceId !== 'string' || priceId.length === 0) {
      throw new PaddleBillingError(
        'invalid_response',
        'Paddle subscription returned an invalid item',
      );
    }
    return {
      price: { id: priceId },
    };
  });

  return {
    event_type: 'subscription.updated',
    occurred_at: requiredTimestamp(subscription, 'updated_at', 'subscription'),
    data: {
      id: requiredString(subscription, 'id', 'subscription'),
      status: requiredString(subscription, 'status', 'subscription'),
      customer_id: requiredString(subscription, 'customer_id', 'subscription'),
      custom_data:
        typeof lectorUserId === 'string' && lectorUserId.length > 0 ? { lectorUserId } : null,
      current_billing_period:
        currentBillingPeriod && typeof currentBillingPeriod.ends_at === 'string'
          ? { ends_at: currentBillingPeriod.ends_at }
          : null,
      items,
    },
  };
}

function asBillingMoney(value: unknown, fallbackCurrency: string | null): BillingMoney | null {
  const record = asRecord(value);
  const details = asRecord(record?.details);
  const totals = asRecord(details?.totals) ?? asRecord(record?.totals);
  const amount = totals?.grand_total;
  const currency = totals?.currency_code ?? fallbackCurrency;
  if (
    typeof amount !== 'string' ||
    !/^-?\d+$/.test(amount) ||
    typeof currency !== 'string' ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return null;
  }
  return { amount, currencyCode: currency };
}

function assertCustomerPortalUrl(value: unknown, environment: PaddleEnvironment): string {
  if (typeof value !== 'string') {
    throw new PaddleBillingError('invalid_response', 'Paddle portal response omitted its URL');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PaddleBillingError(
      'invalid_response',
      'Paddle portal response returned an invalid URL',
    );
  }
  if (url.protocol !== 'https:' || !CUSTOMER_PORTAL_HOSTS[environment].has(url.hostname)) {
    throw new PaddleBillingError(
      'invalid_response',
      'Paddle portal response returned an unexpected host',
    );
  }
  return url.toString();
}

interface PaddleSubscriptionItem {
  quantity: number;
  priceId: string;
}

function parseSubscriptionItems(value: unknown): PaddleSubscriptionItem[] {
  const data = asRecord(value)?.data;
  const items = asRecord(data)?.items;
  if (!Array.isArray(items)) {
    throw new PaddleBillingError(
      'invalid_response',
      'Paddle subscription response omitted its items',
    );
  }
  return items.map((raw) => {
    const item = asRecord(raw);
    const price = asRecord(item?.price);
    const priceId = price?.id;
    const quantity = item?.quantity;
    if (
      typeof priceId !== 'string' ||
      typeof quantity !== 'number' ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1
    ) {
      throw new PaddleBillingError(
        'invalid_response',
        'Paddle subscription returned an invalid item',
      );
    }
    return { priceId, quantity };
  });
}

function replacementItems(
  current: readonly PaddleSubscriptionItem[],
  targetPriceId: string,
  managedPriceIds: readonly string[],
): Array<{ price_id: string; quantity: number }> {
  const managed = new Set(managedPriceIds);
  if (!managed.has(targetPriceId)) {
    throw new PaddleBillingError('managed_price_mismatch', 'Target price is not managed by Lector');
  }
  const currentBase = current.filter((item) => managed.has(item.priceId));
  if (currentBase.length !== 1) {
    throw new PaddleBillingError(
      'managed_price_mismatch',
      'Subscription does not contain exactly one managed base price',
    );
  }
  if (currentBase[0].priceId === targetPriceId) {
    throw new PaddleBillingError('already_current', 'Subscription already uses the target price');
  }

  // Preserve any future non-base recurring items. Paddle treats `items` like a
  // PUT: anything omitted is removed from the subscription.
  return [
    ...current
      .filter((item) => !managed.has(item.priceId))
      .map((item) => ({ price_id: item.priceId, quantity: item.quantity })),
    { price_id: targetPriceId, quantity: 1 },
  ];
}

/**
 * Server-side Paddle operations used by the authenticated billing routes.
 * Browser input is limited to one configured target price; customer and
 * subscription identifiers always come from the signed webhook mirror.
 */
export function makePaddleBillingOperations(cfg: {
  apiKey: string | undefined;
  environment: PaddleEnvironment;
}): PaddleBillingOperations & PaddleBillingReader {
  const baseUrl = paddleApiBase(cfg.environment);

  async function request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PADDLE_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${cfg.apiKey ?? ''}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new PaddleBillingError(
          'paddle_unavailable',
          `Paddle ${init.method ?? 'GET'} ${path} returned ${response.status}`,
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof PaddleBillingError) throw error;
      throw new PaddleBillingError(
        'paddle_unavailable',
        error instanceof Error ? error.message : 'Paddle request failed',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async function desiredItems(args: SubscriptionChangeArgs) {
    const current = await request(`/subscriptions/${encodeURIComponent(args.subscriptionId)}`, {
      method: 'GET',
    });
    return replacementItems(
      parseSubscriptionItems(current),
      args.targetPriceId,
      args.managedPriceIds,
    );
  }

  async function listEvents(
    initialPath: string,
    expectedPath: '/customers' | '/subscriptions',
    parse: (value: unknown) => PaddleEvent,
  ): Promise<PaddleEvent[]> {
    const events: PaddleEvent[] = [];
    const seenPages = new Set<string>();
    let path: string | null = initialPath;

    while (path) {
      if (seenPages.has(path) || seenPages.size >= 100) {
        throw new PaddleBillingError('invalid_response', 'Paddle returned invalid pagination');
      }
      seenPages.add(path);
      const response = asRecord(await request(path, { method: 'GET' }));
      if (!response || !Array.isArray(response.data)) {
        throw new PaddleBillingError('invalid_response', 'Paddle list response omitted data');
      }
      events.push(...response.data.map(parse));

      const pagination = asRecord(asRecord(response.meta)?.pagination);
      if (!pagination || typeof pagination.has_more !== 'boolean') {
        throw new PaddleBillingError('invalid_response', 'Paddle list response omitted pagination');
      }
      if (pagination?.has_more !== true) break;
      if (typeof pagination.next !== 'string') {
        throw new PaddleBillingError(
          'invalid_response',
          'Paddle paginated response omitted its next page',
        );
      }
      let next: URL;
      try {
        next = new URL(pagination.next);
      } catch {
        throw new PaddleBillingError('invalid_response', 'Paddle returned an invalid next page');
      }
      const expectedBase = new URL(baseUrl);
      if (next.origin !== expectedBase.origin || next.pathname !== expectedPath) {
        throw new PaddleBillingError('invalid_response', 'Paddle returned an unexpected next page');
      }
      path = `${next.pathname}${next.search}`;
    }
    return events;
  }

  function listPath(
    resource: '/customers' | '/subscriptions',
    filters: Record<string, string>,
  ): string {
    const params = new URLSearchParams({ ...filters, per_page: '200' });
    return `${resource}?${params.toString()}`;
  }

  function chunks<T>(values: readonly T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
    return result;
  }

  function changeBody(
    args: SubscriptionChangeArgs,
    items: Array<{ price_id: string; quantity: number }>,
  ) {
    return JSON.stringify({
      items,
      proration_billing_mode: args.prorationBillingMode,
      on_payment_failure: 'prevent_change',
    });
  }

  return {
    async fetchBillingSnapshot({ email, knownCustomerIds }) {
      const customerEvents = new Map<string, PaddleEvent>();
      const knownIds = [...new Set(knownCustomerIds.filter(Boolean))];

      // Fetch mirror-owned IDs and exact email matches separately: Paddle list
      // filters combine, while this action needs their union to repair both a
      // stale known customer and an entirely missed customer webhook.
      for (const ids of chunks(knownIds, 100)) {
        const events = await listEvents(
          listPath('/customers', { id: ids.join(','), status: 'active,archived' }),
          '/customers',
          customerEvent,
        );
        for (const event of events) customerEvents.set(event.data!.id!, event);
      }
      const emailEvents = await listEvents(
        listPath('/customers', { email, status: 'active,archived' }),
        '/customers',
        customerEvent,
      );
      for (const event of emailEvents) customerEvents.set(event.data!.id!, event);

      const customerIds = [...new Set([...knownIds, ...customerEvents.keys()])];
      const subscriptionEvents = new Map<string, PaddleEvent>();
      for (const ids of chunks(customerIds, 100)) {
        const events = await listEvents(
          listPath('/subscriptions', { customer_id: ids.join(',') }),
          '/subscriptions',
          subscriptionEvent,
        );
        for (const event of events) subscriptionEvents.set(event.data!.id!, event);
      }

      return {
        customers: [...customerEvents.values()],
        subscriptions: [...subscriptionEvents.values()],
      };
    },

    async createPortalSession({ customerId, subscriptionIds }) {
      const uniqueSubscriptionIds = [...new Set(subscriptionIds)].slice(0, 25);
      const response = await request(
        `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
        {
          method: 'POST',
          body: JSON.stringify(
            uniqueSubscriptionIds.length > 0 ? { subscription_ids: uniqueSubscriptionIds } : {},
          ),
        },
      );
      const overview = asRecord(asRecord(asRecord(response)?.data)?.urls)?.general;
      return assertCustomerPortalUrl(asRecord(overview)?.overview, cfg.environment);
    },

    async previewSubscriptionChange(args) {
      const items = await desiredItems(args);
      const response = await request(
        `/subscriptions/${encodeURIComponent(args.subscriptionId)}/preview`,
        {
          method: 'PATCH',
          body: changeBody(args, items),
        },
      );
      const data = asRecord(asRecord(response)?.data);
      if (!data) {
        throw new PaddleBillingError(
          'invalid_response',
          'Paddle subscription preview omitted its data',
        );
      }
      const currency = typeof data.currency_code === 'string' ? data.currency_code : null;
      return {
        immediateCharge: asBillingMoney(data.immediate_transaction, currency),
        nextCharge: asBillingMoney(data.next_transaction, currency),
        recurringCharge: asBillingMoney(data.recurring_transaction_details, currency),
      };
    },

    async applySubscriptionChange(args) {
      const items = await desiredItems(args);
      await request(`/subscriptions/${encodeURIComponent(args.subscriptionId)}`, {
        method: 'PATCH',
        body: changeBody(args, items),
      });
    },
  };
}
