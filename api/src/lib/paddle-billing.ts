import { paddleApiBase, type PaddleEnvironment } from './billing';

const PADDLE_REQUEST_TIMEOUT_MS = 15_000;
const CUSTOMER_PORTAL_HOSTS = new Set(['customer-portal.paddle.com', 'buyer-portal.paddle.com']);

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

function assertCustomerPortalUrl(value: unknown): string {
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
  if (url.protocol !== 'https:' || !CUSTOMER_PORTAL_HOSTS.has(url.hostname)) {
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
}): PaddleBillingOperations {
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
      return assertCustomerPortalUrl(asRecord(overview)?.overview);
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
