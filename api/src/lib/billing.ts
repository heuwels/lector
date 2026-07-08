/**
 * Paddle billing gate (#224) — the bare-minimum "paying members only" layer
 * for cloud proper. Lector Cloud has no free tier: an account with no active
 * Paddle subscription is locked to data takeout + subscribing (#216's lapse
 * behaviour, minimally).
 *
 * Moving parts:
 *   - Paddle (merchant of record) owns checkout, tax, dunning, and the
 *     subscription state machine. Our only outbound call is creating a
 *     checkout transaction (makePaddleTransactionCreator → POST /transactions)
 *     so checkout can be opened on the approved lector.dev domain — we never
 *     poll or read subscription state. Entitlement flows the other way:
 *     signature-verified webhooks (routes/billing.ts) are mirrored into
 *     billing_customers / billing_subscriptions and that mirror is the whole
 *     source of truth here.
 *   - `makeBillingMiddleware` enforces the mirror on /api/* after the session
 *     and PAT middlewares resolve the tenant. No entitled subscription → 402,
 *     which the UI turns into the /subscribe screen.
 *
 * Enforcement is opt-in per deployment: `LECTOR_BILLING=paddle` (strictly
 * parsed, like LECTOR_MODE) and only meaningful in cloud proper — selfhost
 * has no accounts to bill. Everything else (canary soak, e2e, dev) runs with
 * billing off and behaves exactly as before this file existed.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { createMiddleware } from 'hono/factory';
import { db } from '../db';

export type BillingMode = 'off' | 'paddle';
export type PaddleEnvironment = 'production' | 'sandbox';

/** Paddle Billing subscription statuses (developer.paddle.com). */
export type PaddleSubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'paused'
  | 'canceled';

/**
 * Statuses that keep the account usable. `past_due` stays entitled on
 * purpose: Paddle is mid-dunning (retrying the card over days) and #224
 * specifies access unchanged during that grace window. Cancel-at-period-end
 * needs no case of its own — Paddle keeps status `active` until the period
 * actually ends.
 */
const ENTITLED_STATUSES: readonly PaddleSubscriptionStatus[] = [
  'active',
  'trialing',
  'past_due',
];

export function isEntitledStatus(status: string | null): boolean {
  return status !== null && (ENTITLED_STATUSES as readonly string[]).includes(status);
}

/**
 * Parse a raw LECTOR_BILLING env value. Unset/empty → 'off' (every
 * deployment to date). Only 'paddle' turns enforcement on; anything else
 * throws — a typo silently disabling the paywall would be a fail-open
 * footgun (same posture as parseLectorMode).
 */
export function parseBillingMode(raw: string | undefined): BillingMode {
  const value = (raw ?? '').trim();
  if (value === '') return 'off';
  if (value === 'paddle') return 'paddle';
  throw new Error(
    `Invalid LECTOR_BILLING "${value}" — expected "paddle" (or unset for no billing).`,
  );
}

/** Parse PADDLE_ENV. Unset/empty → 'production'; only 'sandbox' opts out. */
export function parsePaddleEnvironment(raw: string | undefined): PaddleEnvironment {
  const value = (raw ?? '').trim();
  if (value === '') return 'production';
  if (value === 'production' || value === 'sandbox') return value;
  throw new Error(`Invalid PADDLE_ENV "${value}" — expected "production" or "sandbox".`);
}

/** Paddle REST API base for the configured environment. */
export function paddleApiBase(environment: PaddleEnvironment): string {
  return environment === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';
}

/**
 * Boot-path guard, `assertBootableMode`'s billing twin. Enforcement without a
 * way to ever mark an account paid — no webhook secret (nothing can flip an
 * account active) or no API key (no account can even start checkout) — would
 * lock every account out; billing outside cloud proper means there are no
 * accounts to attach subscriptions to. All deploy mistakes — refuse to boot.
 */
export function assertBillingBootable(
  billing: BillingMode,
  authRequired: boolean,
  hasWebhookSecret: boolean,
  hasApiKey: boolean,
): void {
  if (billing !== 'paddle') return;
  if (!authRequired) {
    throw new Error(
      'LECTOR_BILLING=paddle requires cloud proper (LECTOR_MODE=cloud without an external ' +
        'gate): subscriptions attach to built-in accounts (heuwels/lector#218). Unset ' +
        'LECTOR_BILLING, or run cloud mode with built-in auth.',
    );
  }
  if (!hasWebhookSecret) {
    throw new Error(
      'LECTOR_BILLING=paddle requires PADDLE_WEBHOOK_SECRET: without Paddle webhooks no ' +
        'account can ever become paid, so enforcement would lock everyone out. Copy the ' +
        "endpoint's secret key from Paddle → Developer tools → Notifications.",
    );
  }
  if (!hasApiKey) {
    throw new Error(
      'LECTOR_BILLING=paddle requires PADDLE_API_KEY: checkout is created server-side (a ' +
        'Paddle transaction) and opened on the approved lector.dev domain, so without the ' +
        'key no account could start a subscription and enforcement would lock everyone out. ' +
        'Create a server-side key in Paddle → Developer tools → Authentication.',
    );
  }
}

/** A plan the /subscribe screen can open Paddle checkout for. */
export interface BillingPrice {
  /** Paddle price id (pri_…). */
  id: string;
  plan: 'cloud' | 'plus';
  cycle: 'month' | 'year';
}

function pricesFromEnv(env: NodeJS.ProcessEnv): BillingPrice[] {
  const prices: BillingPrice[] = [];
  const add = (
    key: string,
    id: string | undefined,
    plan: BillingPrice['plan'],
    cycle: BillingPrice['cycle'],
  ) => {
    if (!id) return;
    // A Paddle price id, not an amount: "pri_…". Configuring "5" here (it
    // has happened) fails silently at Paddle's end when checkout opens —
    // warn loudly but still serve it, so the fix stays a param change.
    if (!id.startsWith('pri_')) {
      console.warn(
        `[billing] ${key}="${id}" does not look like a Paddle price id (pri_…) — checkout ` +
          'will fail for this plan. Use the id from Paddle → Catalog → Prices.',
      );
    }
    prices.push({ id, plan, cycle });
  };
  add('PADDLE_PRICE_MONTHLY', env.PADDLE_PRICE_MONTHLY, 'cloud', 'month');
  add('PADDLE_PRICE_ANNUAL', env.PADDLE_PRICE_ANNUAL, 'cloud', 'year');
  add('PADDLE_PRICE_PLUS_MONTHLY', env.PADDLE_PRICE_PLUS_MONTHLY, 'plus', 'month');
  add('PADDLE_PRICE_PLUS_ANNUAL', env.PADDLE_PRICE_PLUS_ANNUAL, 'plus', 'year');
  return prices;
}

/** Comma-separated BILLING_EXEMPT_EMAILS → lowercased set. */
export function parseExemptEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Resolved billing config — read once at import, like lib/config.ts.
 * `enforced` is the single switch the middleware and routes branch on.
 */
export const billingConfig: {
  readonly mode: BillingMode;
  readonly enforced: boolean;
  readonly webhookSecret: string | undefined;
  readonly apiKey: string | undefined;
  readonly environment: PaddleEnvironment;
  readonly prices: BillingPrice[];
  readonly exemptEmails: Set<string>;
} = (() => {
  const mode = parseBillingMode(process.env.LECTOR_BILLING);
  return {
    mode,
    enforced: mode === 'paddle',
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET || undefined,
    apiKey: process.env.PADDLE_API_KEY || undefined,
    environment: parsePaddleEnvironment(process.env.PADDLE_ENV),
    prices: pricesFromEnv(process.env),
    exemptEmails: parseExemptEmails(process.env.BILLING_EXEMPT_EMAILS),
  } as const;
})();

/**
 * Checkout creation — the one outbound Paddle call. A locked account picks a
 * plan in-app; we create a Paddle transaction server-side stamped with
 * custom_data.lectorUserId (the webhook's primary match key), then hand the
 * browser its id (`txn_…`). The overlay is opened for that transaction on the
 * approved lector.dev domain — app.lector.dev is not an approved checkout
 * domain, which is the whole reason checkout is deferred to the marketing
 * site. This call grants nothing on its own: entitlement still arrives only
 * through the webhook mirror above.
 */
export interface CheckoutTransaction {
  /** Paddle transaction id (txn_…) — the browser opens the overlay for this. */
  id: string;
  /** Paddle's own checkout URL, when a default payment link is configured. */
  checkoutUrl: string | null;
}

export type CreateTransaction = (args: {
  priceId: string;
  userId: string;
  customerId: string | null;
}) => Promise<CheckoutTransaction>;

/**
 * The prod transaction creator (test seam: routes bind their own). POSTs the
 * chosen price with the tenant in custom_data; passes a known customer id when
 * we have one so a returning subscriber's details prefill. `collection_mode:
 * automatic` is what makes the transaction checkout-able (vs an invoice).
 */
export function makePaddleTransactionCreator(cfg: {
  apiKey: string | undefined;
  environment: PaddleEnvironment;
}): CreateTransaction {
  return async ({ priceId, userId, customerId }) => {
    const res = await fetch(`${paddleApiBase(cfg.environment)}/transactions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        custom_data: { lectorUserId: userId },
        collection_mode: 'automatic',
        ...(customerId ? { customer_id: customerId } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`Paddle POST /transactions ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data?: { id?: string; checkout?: { url?: string } | null };
    };
    const id = json.data?.id;
    if (!id) throw new Error('Paddle transaction response missing data.id');
    return { id, checkoutUrl: json.data?.checkout?.url ?? null };
  };
}

/**
 * The Paddle customer id last mirrored for this email, if any — lets a
 * returning/lapsed subscriber's checkout prefill their details. Read-only
 * against the same mirror the webhook writes; null when we've never seen them.
 */
export function findPaddleCustomerId(email: string | null): string | null {
  if (!email) return null;
  const row = db
    .prepare(
      'SELECT paddleCustomerId FROM billing_customers WHERE email = lower(?) ORDER BY occurredAt DESC LIMIT 1',
    )
    .get(email) as { paddleCustomerId: string } | undefined;
  return row?.paddleCustomerId ?? null;
}

/**
 * Verify a Paddle webhook signature: `Paddle-Signature: ts=<unix>;h1=<hex>`,
 * where h1 = HMAC-SHA256(`${ts}:${rawBody}`, endpoint secret). Multiple h1
 * values appear during secret rotation — any match passes. The timestamp
 * window blunts replays; 60s (not Paddle's suggested 5s) tolerates clock
 * skew, and a replayed event is idempotent anyway (applyPaddleEvent ignores
 * anything not newer than the stored row).
 */
export function verifyPaddleSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;

  let ts: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) return false;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'h1') signatures.push(...value.split(',').filter(Boolean));
  }
  if (!ts || signatures.length === 0) return false;

  const eventTime = Number(ts);
  if (!Number.isFinite(eventTime)) return false;
  if (Math.abs(nowSeconds - eventTime) > 60) return false;

  const expected = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
  const expectedBuf = Buffer.from(expected);
  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}

/** The slice of a Paddle webhook event the mirror needs. */
interface PaddleEvent {
  event_type?: string;
  occurred_at?: string;
  data?: {
    id?: string;
    email?: string;
    status?: string;
    customer_id?: string;
    custom_data?: { lectorUserId?: unknown } | null;
    current_billing_period?: { ends_at?: string } | null;
    items?: Array<{ price?: { id?: string } | null }> | null;
  };
}

export type AppliedEvent = 'customer' | 'subscription' | 'ignored' | 'stale';

/**
 * Mirror one verified webhook event. Paddle retries deliveries and does not
 * guarantee order, so both upserts only apply when the event is strictly
 * newer (occurred_at) than the stored row — replays and stragglers are
 * reported 'stale' and dropped.
 */
export function applyPaddleEvent(evt: PaddleEvent): AppliedEvent {
  const type = evt.event_type ?? '';
  const data = evt.data;
  const occurredAt = evt.occurred_at;
  const now = new Date().toISOString();

  if (type.startsWith('customer.')) {
    if (!data?.id || !data.email || !occurredAt) return 'ignored';
    const changed = db
      .prepare(
        `INSERT INTO billing_customers (paddleCustomerId, email, occurredAt, updatedAt)
         VALUES (?, lower(?), ?, ?)
         ON CONFLICT(paddleCustomerId) DO UPDATE SET
           email = excluded.email,
           occurredAt = excluded.occurredAt,
           updatedAt = excluded.updatedAt
         WHERE excluded.occurredAt > billing_customers.occurredAt`,
      )
      .run(data.id, data.email, occurredAt, now).changes;
    return changed > 0 ? 'customer' : 'stale';
  }

  if (type.startsWith('subscription.')) {
    if (!data?.id || !data.status || !data.customer_id || !occurredAt) return 'ignored';
    const customData = data.custom_data;
    const userId =
      customData && typeof customData.lectorUserId === 'string' && customData.lectorUserId
        ? customData.lectorUserId
        : null;
    const changed = db
      .prepare(
        `INSERT INTO billing_subscriptions
           (paddleSubscriptionId, paddleCustomerId, userId, status, priceId,
            currentPeriodEnd, occurredAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(paddleSubscriptionId) DO UPDATE SET
           paddleCustomerId = excluded.paddleCustomerId,
           userId = COALESCE(excluded.userId, billing_subscriptions.userId),
           status = excluded.status,
           priceId = COALESCE(excluded.priceId, billing_subscriptions.priceId),
           currentPeriodEnd = excluded.currentPeriodEnd,
           occurredAt = excluded.occurredAt,
           updatedAt = excluded.updatedAt
         WHERE excluded.occurredAt > billing_subscriptions.occurredAt`,
      )
      .run(
        data.id,
        data.customer_id,
        userId,
        data.status,
        data.items?.[0]?.price?.id ?? null,
        data.current_billing_period?.ends_at ?? null,
        occurredAt,
        now,
      ).changes;
    return changed > 0 ? 'subscription' : 'stale';
  }

  // transaction.*, adjustment.*, … carry nothing the mirror needs — the
  // subscription events already hold status + period. 200 them so Paddle
  // doesn't retry.
  return 'ignored';
}

/**
 * The account's best subscription status, or null when it has none. Matches
 * by tenant first (checkout opened in-app stamps custom_data.lectorUserId),
 * then by the account email against Paddle's customer email (checkout on
 * lector.dev, possibly before the account existed). An account can
 * legitimately have several rows (canceled + resubscribed) — the most
 * entitled one wins.
 */
export function resolveBillingStatus(userId: string, email: string | null): string | null {
  const rows = db
    .prepare(
      `SELECT DISTINCT s.status FROM billing_subscriptions s
       LEFT JOIN billing_customers c ON c.paddleCustomerId = s.paddleCustomerId
       WHERE s.userId = ? OR (? IS NOT NULL AND c.email = lower(?))`,
    )
    .all(userId, email, email) as Array<{ status: string }>;
  if (rows.length === 0) return null;

  const rank: readonly string[] = ['active', 'trialing', 'past_due', 'paused', 'canceled'];
  let best = rows[0].status;
  for (const { status } of rows) {
    const current = rank.indexOf(status);
    const bestIdx = rank.indexOf(best);
    // Unknown statuses (a future Paddle addition) rank worst — fail closed.
    if (current !== -1 && (bestIdx === -1 || current < bestIdx)) best = status;
  }
  return best;
}

/**
 * The account email for a tenant, from Better Auth's `user` table. Null in
 * deployments where that table doesn't exist (selfhost — enforcement is
 * never on there, but the guard must not throw).
 */
export function getUserEmail(userId: string): string | null {
  try {
    const row = db.prepare('SELECT email FROM user WHERE id = ?').get(userId) as
      | { email: string }
      | undefined;
    return row?.email ?? null;
  } catch {
    return null;
  }
}

export interface BillingGateOptions {
  enforced: boolean;
  exemptEmails: Set<string>;
  /** Test seam; prod uses the `user`-table lookup. */
  resolveEmail?: (userId: string) => string | null;
}

/**
 * The gate (#224). Mounted on /api/* AFTER the session and PAT middlewares,
 * so the tenant is already resolved whichever credential carried it. An
 * account without an entitled subscription gets 402 `subscription_required`
 * everywhere except:
 *
 *   - /api/auth/* — sign-in/up/out must work for locked accounts (and these
 *     requests carry no tenant to check).
 *   - /api/billing/* — the webhook is how an account BECOMES paid, and the
 *     status endpoint is what the /subscribe screen polls.
 *   - GET /api/data — data takeout. #216's lapse contract: a locked account
 *     can always export everything and walk away. (POST /api/data — import —
 *     stays locked.)
 *
 * BILLING_EXEMPT_EMAILS bypasses the check (operator + test accounts).
 */
export function makeBillingMiddleware(opts: BillingGateOptions) {
  const resolveEmail = opts.resolveEmail ?? getUserEmail;
  return createMiddleware(async (c, next) => {
    if (!opts.enforced) return next();

    const path = c.req.path;
    if (path.startsWith('/api/auth/')) return next();
    if (path === '/api/billing' || path.startsWith('/api/billing/')) return next();
    const method = c.req.method;
    if (path === '/api/data' && (method === 'GET' || method === 'HEAD')) return next();

    // Set by the session or PAT middleware. Absent means a wiring bug (a
    // route mounted before those middlewares) — fail closed like lib/user.ts.
    const userId = c.get('userId');
    if (typeof userId !== 'string' || userId.length === 0) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const email = resolveEmail(userId);
    if (email && opts.exemptEmails.has(email.toLowerCase())) return next();

    const status = resolveBillingStatus(userId, email);
    if (isEntitledStatus(status)) return next();

    return c.json({ error: 'subscription_required', status: status ?? 'none' }, 402);
  });
}

/** The prod middleware, bound to the resolved billing config. */
export const billingMiddleware = makeBillingMiddleware({
  enforced: billingConfig.enforced,
  exemptEmails: billingConfig.exemptEmails,
});
