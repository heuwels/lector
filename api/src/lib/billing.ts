/**
 * Paddle billing gate (#224) and derived Free access. Paid entitlement still
 * comes only from Paddle's mirror; when the strict LECTOR_FREE_TIER rollout
 * flag is enabled, an authenticated non-suspended account without an entitled
 * row may continue on server-enforced Free limits.
 *
 * Moving parts:
 *   - Paddle (merchant of record) owns checkout, tax, dunning, and the
 *     subscription state machine. Authenticated account-management routes may
 *     create checkout/portal sessions and preview or request allowlisted plan
 *     changes. Entitlement still flows only the other way:
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
import { getUserCreatedAtMs } from './account-age';
import { isBillingExempt } from './account-flags';

export type BillingMode = 'off' | 'paddle';
export type PaddleEnvironment = 'production' | 'sandbox';

/** Paddle Billing subscription statuses (developer.paddle.com). */
export type PaddleSubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled';

/**
 * Statuses that keep the account usable. `past_due` stays entitled on
 * purpose: Paddle is mid-dunning (retrying the card over days) and #224
 * specifies access unchanged during that grace window. Cancel-at-period-end
 * needs no case of its own — Paddle keeps status `active` until the period
 * actually ends.
 */
const ENTITLED_STATUSES: readonly PaddleSubscriptionStatus[] = ['active', 'trialing', 'past_due'];

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

/**
 * Strict rollout flag: only exact lowercase `true` enables Free. Empty,
 * unset, and exact `false` preserve the paid-only product; every other value
 * is a deployment typo and refuses to boot.
 */
export function parseFreeTierEnabled(raw: string | undefined): boolean {
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new Error(`Invalid LECTOR_FREE_TIER "${raw}" — expected "true", "false", or unset.`);
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * LECTOR_FREE_TIER_CUTOFF as epoch ms, or null when unset. The value must carry
 * a zone, so the cutoff does not move with the server's local time.
 */
export function parseFreeTierCutoff(raw: string | undefined): number | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  const ms = ISO_INSTANT.test(value) ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) {
    throw new Error(
      `Invalid LECTOR_FREE_TIER_CUTOFF "${value}" — expected an ISO 8601 instant with a zone, for example 2026-12-01T00:00:00Z.`,
    );
  }
  return ms;
}

export interface FreeAccessOptions {
  freeTierEnabled: boolean;
  /** Epoch ms. Accounts created before it keep Free. Null or unset gives Free to every account. */
  freeTierCutoffMs?: number | null;
  /** Test seam; prod reads the Better Auth `user` table. */
  resolveCreatedAtMs?: (userId: string) => number | null;
}

/** An account with an unknown creation time does not get Free once a cutoff is set. */
export function hasFreeAccess(opts: FreeAccessOptions, userId: string): boolean {
  if (!opts.freeTierEnabled) return false;
  const cutoff = opts.freeTierCutoffMs ?? null;
  if (cutoff === null) return true;
  const created = (opts.resolveCreatedAtMs ?? getUserCreatedAtMs)(userId);
  return created !== null && created < cutoff;
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
  return environment === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
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
  free: {
    enabled: boolean;
    cutoffSet?: boolean;
    production: boolean;
    hasTurnstileSecret: boolean;
    hasTurnstileSiteKey: boolean;
    hasCheckoutPrice?: boolean;
    hasGoogleTtsApiKey?: boolean;
    byokAvailable?: boolean;
    classifyWorkerEnabled?: boolean;
    classifyLlmUrl?: string;
    classifyLlmModel?: string;
    llmProvider?: string;
    openAiCompatUrl?: string;
    hasOpenAiCompatApiKey?: boolean;
    wordGlossModel?: string;
    simplePhraseModel?: string;
    simpleContextModel?: string;
  } = {
    enabled: false,
    production: false,
    hasTurnstileSecret: false,
    hasTurnstileSiteKey: false,
  },
): void {
  if (free.cutoffSet && !free.enabled) {
    throw new Error('LECTOR_FREE_TIER_CUTOFF requires LECTOR_FREE_TIER=true.');
  }
  if (free.enabled && billing !== 'paddle') {
    throw new Error('LECTOR_FREE_TIER=true requires LECTOR_BILLING=paddle.');
  }
  if (free.enabled && !authRequired) {
    throw new Error(
      'LECTOR_FREE_TIER=true requires cloud proper (LECTOR_MODE=cloud with built-in accounts).',
    );
  }
  if (free.enabled && free.production && (!free.hasTurnstileSecret || !free.hasTurnstileSiteKey)) {
    throw new Error(
      'LECTOR_FREE_TIER=true in production requires TURNSTILE_SECRET_KEY and ' +
        'TURNSTILE_SITE_KEY so public no-card signup cannot run without bot protection.',
    );
  }
  if (free.enabled && free.production) {
    const expectedUrl = 'https://openrouter.ai/api';
    const expectedModel = 'google/gemini-2.5-flash-lite';
    if (!free.hasCheckoutPrice) {
      throw new Error(
        'LECTOR_FREE_TIER=true in production requires at least one configured PADDLE_PRICE_* so the advertised Cloud upsell can start checkout.',
      );
    }
    if (!free.hasGoogleTtsApiKey) {
      throw new Error(
        'LECTOR_FREE_TIER=true in production requires GOOGLE_CLOUD_API_KEY so the advertised paid managed-voice upsell is available.',
      );
    }
    if (!free.byokAvailable) {
      throw new Error(
        'LECTOR_FREE_TIER=true in production requires a valid BYOK_ENCRYPTION_KEY so Free accounts retain the advertised AI escape hatch.',
      );
    }
    if (free.classifyWorkerEnabled && (!free.classifyLlmUrl || !free.classifyLlmModel)) {
      throw new Error(
        'LECTOR_FREE_TIER=true with CLASSIFY_WORKER=1 requires dedicated CLASSIFY_LLM_URL and CLASSIFY_LLM_MODEL values so Free vocabulary cannot fall back to the unmetered managed translation provider.',
      );
    }
    if (free.llmProvider !== 'openai') {
      throw new Error('LECTOR_FREE_TIER=true in production requires LLM_PROVIDER=openai.');
    }
    if (free.openAiCompatUrl?.replace(/\/$/, '') !== expectedUrl) {
      throw new Error(
        `LECTOR_FREE_TIER=true in production requires OPENAI_COMPAT_URL=${expectedUrl}.`,
      );
    }
    if (!free.hasOpenAiCompatApiKey) {
      throw new Error(
        'LECTOR_FREE_TIER=true in production requires OPENAI_COMPAT_API_KEY for managed translations.',
      );
    }
    const taskModels = [
      ['OPENAI_COMPAT_WORD_GLOSS_MODEL', free.wordGlossModel],
      ['OPENAI_COMPAT_SIMPLE_PHRASE_MODEL', free.simplePhraseModel],
      ['OPENAI_COMPAT_SIMPLE_CONTEXT_MODEL', free.simpleContextModel],
    ] as const;
    for (const [name, model] of taskModels) {
      if (model !== expectedModel) {
        throw new Error(`LECTOR_FREE_TIER=true in production requires ${name}=${expectedModel}.`);
      }
    }
  }

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

/**
 * Paddle prices that carry a paid `trial_period` (developer.paddle.com →
 * Trials). Paddle charges the trial price at checkout, holds the subscription
 * in `trialing`, then renews at the base price. A trial price must bill the
 * same base amount as the standard monthly price of its plan.
 *
 * Paddle keeps a subscription on its trial price id after the trial. Each id
 * here therefore maps to a plan for the life of that subscription, and the
 * list does not depend on the offer. `trialPriceFor` decides the offer.
 */
export function trialPricesFromEnv(
  env: NodeJS.ProcessEnv,
  standard: BillingPrice[],
): BillingPrice[] {
  const trials: BillingPrice[] = [];
  const add = (key: string, id: string | undefined, plan: BillingPrice['plan']) => {
    if (!id) return;
    if (!id.startsWith('pri_')) {
      console.warn(`[billing] ${key}="${id}" does not look like a Paddle price id (pri_…).`);
    }
    if (!standard.some((p) => p.plan === plan && p.cycle === 'month')) {
      console.warn(
        `[billing] ${key} has no standard monthly price of the same plan. Checkout does not offer it.`,
      );
    }
    trials.push({ id, plan, cycle: 'month' });
  };
  add('PADDLE_PRICE_MONTHLY_TRIAL', env.PADDLE_PRICE_MONTHLY_TRIAL, 'cloud');
  add('PADDLE_PRICE_PLUS_MONTHLY_TRIAL', env.PADDLE_PRICE_PLUS_MONTHLY_TRIAL, 'plus');
  return trials;
}

/**
 * LECTOR_TRIAL_OFFER. The offer is on unless the value is `false`. Use it to
 * stop the $1 first month. Do not remove a trial price id for that purpose,
 * because subscribers that started on it keep that price id.
 */
export function parseTrialOfferEnabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() !== 'false';
}

/** A scheduled cancel or pause means that Paddle does not renew the subscription. */
export function stopsRenewal(scheduledChange: string | null | undefined): boolean {
  return scheduledChange === 'cancel' || scheduledChange === 'pause';
}

/** True when `priceId` is a configured trial price. */
export function isTrialPriceId(
  cfg: { trialPrices?: readonly BillingPrice[] },
  priceId: string | null | undefined,
): boolean {
  return !!priceId && (cfg.trialPrices ?? []).some((p) => p.id === priceId);
}

/** Every price id a subscription row can hold: the standard prices, then the trial prices. */
export function knownBillingPrices(cfg: {
  prices: readonly BillingPrice[];
  trialPrices?: readonly BillingPrice[];
}): BillingPrice[] {
  return [...cfg.prices, ...(cfg.trialPrices ?? [])];
}

/**
 * The trial price that replaces `standard` at checkout, or null. Only an
 * account with no subscription row in any status gets one, so a canceled
 * subscriber cannot buy the first month again.
 */
export function trialPriceFor(
  cfg: { trialPrices?: readonly BillingPrice[]; trialOfferEnabled?: boolean },
  standard: BillingPrice,
  priorSubscriptions: number,
): BillingPrice | null {
  if (cfg.trialOfferEnabled === false) return null;
  if (priorSubscriptions > 0 || standard.cycle !== 'month') return null;
  return (cfg.trialPrices ?? []).find((p) => p.plan === standard.plan) ?? null;
}

/**
 * Paddle's own rule for a redeemable code: letters and numbers, at most 32
 * characters (developer.paddle.com → Discounts). Matching it here is what
 * makes "the browser cannot send a discount id" structural rather than a
 * hand-written check: a Paddle id (`dsc_01k…`) contains an underscore and so
 * can never normalise into a lookup key, whatever a client puts in `promo`.
 * The length cap also bounds what an arbitrary query parameter can push into
 * a log line.
 */
const DISCOUNT_CODE_PATTERN = /^[A-Z0-9]{1,32}$/;

/** A code word normalised for lookup, or null when it could never be one. */
export function normalizeDiscountCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return DISCOUNT_CODE_PATTERN.test(code) ? code : null;
}

/**
 * Campaign coupons (#516): a map from the code word a reader types to a
 * Paddle discount id. Paddle owns the discount itself — percentage, duration,
 * expiry, usage limit — so this map is only the lookup, and the next campaign
 * needs a parameter change and no release.
 *
 *   PADDLE_DISCOUNT_CODES={"PRODUCTHUNT":"dsc_01k…","WINBACK25":"dsc_01m…"}
 *
 * A bad entry warns and drops, like LECTOR_PLAN_LIMITS, and never throws.
 * That direction is the safe one: a broken map means no discount resolves, so
 * the reader pays full price and the screen says the code is unknown. Refusing
 * to boot the whole deployment over a marketing parameter is the worse trade.
 * Unset or empty turns coupons off, which is every deployment to date.
 */
export function parseDiscountCodes(raw: string | undefined): Map<string, string> {
  const codes = new Map<string, string>();
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return codes;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    console.warn('[billing] PADDLE_DISCOUNT_CODES is not valid JSON — coupons are off.');
    return codes;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn('[billing] PADDLE_DISCOUNT_CODES must be a JSON object — coupons are off.');
    return codes;
  }

  for (const [rawCode, id] of Object.entries(parsed)) {
    const code = normalizeDiscountCode(rawCode);
    if (code === null) {
      console.warn(
        `[billing] PADDLE_DISCOUNT_CODES key "${rawCode}" is not a usable code word ` +
          '(letters and numbers, 32 max) — ignored.',
      );
      continue;
    }
    // A Paddle discount id, not a percentage: "dsc_…". Configuring "50" here
    // would fail at Paddle's end once checkout opened, so drop it now and say
    // why — the same posture pricesFromEnv takes for pri_ ids.
    if (typeof id !== 'string' || !id.startsWith('dsc_')) {
      console.warn(
        `[billing] PADDLE_DISCOUNT_CODES.${code} must be a Paddle discount id (dsc_…) — ` +
          'ignored. Use the id from Paddle → Catalog → Discounts.',
      );
      continue;
    }
    codes.set(code, id);
  }
  return codes;
}

/** What the /subscribe screen must tell the reader about their code. */
export type DiscountOutcome = 'applied' | 'unknown' | 'none';

/**
 * Resolve a client-supplied `promo` against the configured map. The client
 * names a choice and the server resolves it, exactly like the price check in
 * routes/billing.ts — an unresolvable code is reported, never forwarded.
 *
 * `unknown` and `none` are deliberately different outcomes. A reader who typed
 * something must be told it did not work, because they would otherwise meet a
 * different number in the Paddle overlay. A reader who typed nothing has
 * nothing to be told.
 */
export function resolveDiscount(
  codes: ReadonlyMap<string, string>,
  promo: unknown,
): { outcome: DiscountOutcome; discountId: string | null } {
  const absent =
    promo === undefined || promo === null || (typeof promo === 'string' && promo.trim() === '');
  if (absent) return { outcome: 'none', discountId: null };

  const code = normalizeDiscountCode(promo);
  const discountId = code === null ? undefined : codes.get(code);
  return discountId ? { outcome: 'applied', discountId } : { outcome: 'unknown', discountId: null };
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
  readonly freeTierEnabled: boolean;
  readonly freeTierCutoffMs: number | null;
  readonly webhookSecret: string | undefined;
  readonly apiKey: string | undefined;
  readonly environment: PaddleEnvironment;
  readonly prices: BillingPrice[];
  readonly trialPrices: BillingPrice[];
  readonly trialOfferEnabled: boolean;
  readonly exemptEmails: Set<string>;
  readonly discountCodes: ReadonlyMap<string, string>;
} = (() => {
  const mode = parseBillingMode(process.env.LECTOR_BILLING);
  const prices = pricesFromEnv(process.env);
  return {
    mode,
    enforced: mode === 'paddle',
    freeTierEnabled: parseFreeTierEnabled(process.env.LECTOR_FREE_TIER),
    freeTierCutoffMs: parseFreeTierCutoff(process.env.LECTOR_FREE_TIER_CUTOFF),
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET || undefined,
    apiKey: process.env.PADDLE_API_KEY || undefined,
    environment: parsePaddleEnvironment(process.env.PADDLE_ENV),
    prices,
    trialPrices: trialPricesFromEnv(process.env, prices),
    trialOfferEnabled: parseTrialOfferEnabled(process.env.LECTOR_TRIAL_OFFER),
    exemptEmails: parseExemptEmails(process.env.BILLING_EXEMPT_EMAILS),
    discountCodes: parseDiscountCodes(process.env.PADDLE_DISCOUNT_CODES),
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
  /** Resolved server-side from PADDLE_DISCOUNT_CODES (#516); never client input. */
  discountId?: string | null;
}) => Promise<CheckoutTransaction>;

/**
 * The prod transaction creator (test seam: routes bind their own). POSTs the
 * chosen price with the tenant in custom_data; passes a known customer id when
 * we have one so a returning subscriber's details prefill. `collection_mode:
 * automatic` is what makes the transaction checkout-able (vs an invoice).
 *
 * `discount_id` (#516) is what prices a campaign coupon. Paddle applies it as
 * it prices the transaction, so the overlay opens on the discounted total and
 * the reader never sees one number here and another there. It is omitted
 * unless the route resolved a configured code.
 */
export function makePaddleTransactionCreator(cfg: {
  apiKey: string | undefined;
  environment: PaddleEnvironment;
}): CreateTransaction {
  return async ({ priceId, userId, customerId, discountId }) => {
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
        ...(discountId ? { discount_id: discountId } : {}),
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

export interface BillingSubscriptionRecord {
  paddleSubscriptionId: string;
  paddleCustomerId: string;
  status: string;
  priceId: string | null;
  currentPeriodEnd: string | null;
  /** Paddle `scheduled_change.action` (`cancel`, `pause`, `resume`), or null. */
  scheduledChange: string | null;
  occurredAt: string;
}

/**
 * Every mirrored subscription belonging to an account, newest first. Tenant
 * metadata is authoritative when checkout started in-app; the customer-email
 * fallback preserves purchases made on lector.dev before signup.
 */
export function findBillingSubscriptions(
  userId: string,
  email: string | null,
): BillingSubscriptionRecord[] {
  return db
    .prepare(
      `SELECT DISTINCT
         s.paddleSubscriptionId,
         s.paddleCustomerId,
         s.status,
         s.priceId,
         s.currentPeriodEnd,
         s.scheduledChange,
         s.occurredAt
       FROM billing_subscriptions s
       LEFT JOIN billing_customers c ON c.paddleCustomerId = s.paddleCustomerId
       WHERE s.userId = ? OR (? IS NOT NULL AND c.email = lower(?))
       ORDER BY s.occurredAt DESC`,
    )
    .all(userId, email, email) as BillingSubscriptionRecord[];
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
export interface PaddleEvent {
  event_type?: string;
  occurred_at?: string;
  data?: {
    id?: string;
    email?: string;
    status?: string;
    customer_id?: string;
    custom_data?: { lectorUserId?: unknown } | null;
    current_billing_period?: { ends_at?: string } | null;
    scheduled_change?: { action?: string } | null;
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
            currentPeriodEnd, scheduledChange, occurredAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(paddleSubscriptionId) DO UPDATE SET
           paddleCustomerId = excluded.paddleCustomerId,
           userId = COALESCE(excluded.userId, billing_subscriptions.userId),
           status = excluded.status,
           priceId = COALESCE(excluded.priceId, billing_subscriptions.priceId),
           currentPeriodEnd = excluded.currentPeriodEnd,
           scheduledChange = excluded.scheduledChange,
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
        typeof data.scheduled_change?.action === 'string' ? data.scheduled_change.action : null,
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
  const rows = findBillingSubscriptions(userId, email);
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

export interface BillingGateOptions extends FreeAccessOptions {
  enforced: boolean;
  exemptEmails: Set<string>;
  /** Test seam; prod uses the `user`-table lookup. */
  resolveEmail?: (userId: string) => string | null;
  /**
   * Dynamic per-account billing exemption set from the admin dashboard
   * (#221 "comp a tester") — the DB-backed twin of exemptEmails. Test seam;
   * prod reads admin_account_flags via lib/account-flags.
   */
  isBillingExempt?: (userId: string) => boolean;
}

/**
 * The gate (#224). Mounted on /api/* AFTER the session and PAT middlewares,
 * so the tenant is already resolved whichever credential carried it. With
 * Free off, an account without an entitled subscription gets 402
 * `subscription_required` everywhere except; with Free on, an authenticated
 * non-suspended tenant proceeds to the entitlement engine:
 *
 *   - /api/auth/* — sign-in/up/out must work for locked accounts (and these
 *     requests carry no tenant to check).
 *   - /api/billing/* — the webhook is how an account BECOMES paid, and the
 *     status endpoint is what the /subscribe screen polls.
 *   - /api/email/unsubscribe — signed stop-mail link on product mail.
 *   - GET /api/data — data takeout. #216's lapse contract: a locked account
 *     can always export everything and walk away. (POST /api/data — import —
 *     stays locked.)
 *
 * BILLING_EXEMPT_EMAILS (env) and a per-account comp flag (#221, admin
 * dashboard) both bypass the check — operator + test/comped accounts.
 */
export function makeBillingMiddleware(opts: BillingGateOptions) {
  const resolveEmail = opts.resolveEmail ?? getUserEmail;
  const checkBillingExempt = opts.isBillingExempt ?? isBillingExempt;
  return createMiddleware(async (c, next) => {
    if (!opts.enforced) return next();

    const path = c.req.path;
    if (path.startsWith('/api/auth/')) return next();
    if (path === '/api/billing' || path.startsWith('/api/billing/')) return next();
    if (path === '/api/email/unsubscribe') return next();
    // Admin surface (#221): the operator runs the service regardless of their
    // own subscription. requireAdmin still guards it — a non-admin gets 403
    // there, never a free pass around billing for ordinary accounts.
    if (path === '/api/admin' || path.startsWith('/api/admin/')) return next();
    const method = c.req.method;
    if (path === '/api/data' && (method === 'GET' || method === 'HEAD')) return next();

    // Set by the session or PAT middleware. Absent means a wiring bug (a
    // route mounted before those middlewares) — fail closed like lib/user.ts.
    const userId = c.get('userId');
    if (typeof userId !== 'string' || userId.length === 0) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    // Suspension is enforced by the preceding accountStatusMiddleware. Once
    // authentication has resolved a tenant, the Free rollout lets every
    // non-suspended account with Free access reach ordinary routes; plan
    // limits remain the server-owned cost/product boundary.
    if (hasFreeAccess(opts, userId)) return next();

    // Comped tester (#221): dynamic per-account exemption, checked before the
    // subscription so it works even with no Paddle row at all.
    if (checkBillingExempt(userId)) return next();

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
  freeTierEnabled: billingConfig.freeTierEnabled,
  freeTierCutoffMs: billingConfig.freeTierCutoffMs,
  exemptEmails: billingConfig.exemptEmails,
});
