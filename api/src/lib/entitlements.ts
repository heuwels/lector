/**
 * Entitlements & plan-limits engine (#222) — the mechanism the tiering rides
 * on. The deliverable is the ENGINE; the limit VALUES are per-plan config
 * (PLAN_LIMITS below, tunable per deployment via LECTOR_PLAN_LIMITS without a
 * code change). All enforcement is server-side in the Hono API — the client
 * only ever *reflects* limits, never decides them.
 *
 * Design:
 *   - The plan comes from the Paddle mirror (#224): the most-entitled
 *     subscription row's priceId maps through billingConfig.prices to
 *     'cloud' | 'plus'. No new state to keep in sync.
 *   - Deployments without billing (selfhost, canary soak, dev, e2e) and
 *     BILLING_EXEMPT_EMAILS accounts resolve to the 'unlimited' plan: every
 *     check allows, byte-identical to pre-#222 behavior.
 *   - Account status (active | past_due | lapsed) is #224's gate: past_due
 *     stays entitled (Paddle dunning grace), and a lapsed account never
 *     reaches these checks — the billing middleware already locks it to
 *     data takeout + billing routes. This engine only answers "how much may
 *     an ACTIVE account do".
 *   - Monthly counters key on a UTC calendar month ('2026-07'); the reset is
 *     the key rolling over. Counters are metering, not bookkeeping: checks
 *     happen before the metered action, increments after it succeeds, so a
 *     failed LLM call never burns allowance.
 *   - BYOK (#223, not yet purchasable) is honored as a flag: it lifts the
 *     product caps and replaces the managed LLM/TTS allowances with high
 *     abuse ceilings (the user pays their own provider). isByok is a seam
 *     until #223 lands key storage.
 *
 * Over-limit responses are 429 { error: 'plan_limit', … } — deliberately NOT
 * 402, which apiFetch hard-navigates to /subscribe (the "not subscribed at
 * all" signal). A plan limit is a soft upsell, not a lockout.
 */
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { db } from '../db';
import { billingConfig, getUserEmail, isEntitledStatus } from './billing';
import { getCompedPlan } from './account-flags';

export type PlanId = 'cloud' | 'plus';
export type ResolvedPlan = PlanId | 'unlimited';

/** null = uncapped. */
export interface PlanLimits {
  /** Max words in a single phrase selection/translation (LingQ caps at 9). */
  phraseSelectionWords: number | null;
  /** Journal words written per UTC calendar month. */
  journalWordsPerMonth: number | null;
  /** Library size: total collections. */
  maxCollections: number | null;
  /** Library size: total lessons. */
  maxLessons: number | null;
  /** Managed-key LLM requests per month. */
  llmRequestsPerMonth: number | null;
  /** Managed-key TTS characters per month. */
  ttsCharsPerMonth: number | null;
}

export type LimitMetric = keyof PlanLimits;

/** The metrics backed by monthly counters (the rest compare live values). */
const METERED: readonly LimitMetric[] = [
  'journalWordsPerMonth',
  'llmRequestsPerMonth',
  'ttsCharsPerMonth',
];

/**
 * Per-plan limit values (#216 "Pricing model", #222 table). Generous by
 * design: a normal $5 user should never see them — they exist to route a
 * heavy managed-key user to BYOK or Plus, and to bound tail-risk API cost.
 */
const DEFAULT_PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  cloud: {
    phraseSelectionWords: 9,
    journalWordsPerMonth: 5_000,
    maxCollections: 50,
    maxLessons: 1_000,
    llmRequestsPerMonth: 5_000,
    ttsCharsPerMonth: 300_000,
  },
  plus: {
    phraseSelectionWords: null,
    journalWordsPerMonth: null,
    maxCollections: null,
    maxLessons: null,
    llmRequestsPerMonth: 20_000,
    ttsCharsPerMonth: 1_500_000,
  },
};

/**
 * BYOK lifts the product caps entirely (the user pays their own provider)
 * but keeps high abuse ceilings on the metered calls, per #222.
 */
const BYOK_LIMITS: PlanLimits = {
  phraseSelectionWords: null,
  journalWordsPerMonth: null,
  maxCollections: null,
  maxLessons: null,
  llmRequestsPerMonth: 50_000,
  ttsCharsPerMonth: 5_000_000,
};

const UNLIMITED: PlanLimits = {
  phraseSelectionWords: null,
  journalWordsPerMonth: null,
  maxCollections: null,
  maxLessons: null,
  llmRequestsPerMonth: null,
  ttsCharsPerMonth: null,
};

/**
 * Merge LECTOR_PLAN_LIMITS over the defaults: a JSON object keyed by plan,
 * values partial PlanLimits (numbers, or null for uncapped). Lets a
 * deployment tune tiers without a code change, e.g.
 *   LECTOR_PLAN_LIMITS='{"cloud":{"journalWordsPerMonth":8000}}'
 * Unknown plans/keys and non-numeric values are ignored with a warning —
 * a typo must never silently zero someone's allowance.
 */
export function parsePlanLimitOverrides(
  raw: string | undefined,
  defaults: Record<PlanId, PlanLimits> = DEFAULT_PLAN_LIMITS,
): Record<PlanId, PlanLimits> {
  const merged: Record<PlanId, PlanLimits> = {
    cloud: { ...defaults.cloud },
    plus: { ...defaults.plus },
  };
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return merged;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    console.warn('[entitlements] LECTOR_PLAN_LIMITS is not valid JSON — using default limits.');
    return merged;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn('[entitlements] LECTOR_PLAN_LIMITS must be an object — using default limits.');
    return merged;
  }

  for (const [plan, overrides] of Object.entries(parsed)) {
    if (plan !== 'cloud' && plan !== 'plus') {
      console.warn(`[entitlements] LECTOR_PLAN_LIMITS: unknown plan "${plan}" ignored.`);
      continue;
    }
    if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
      console.warn(`[entitlements] LECTOR_PLAN_LIMITS.${plan} must be an object — ignored.`);
      continue;
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (!(key in merged[plan])) {
        console.warn(`[entitlements] LECTOR_PLAN_LIMITS.${plan}.${key} is not a limit — ignored.`);
        continue;
      }
      if (value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
        merged[plan][key as LimitMetric] = value as number | null;
      } else {
        console.warn(
          `[entitlements] LECTOR_PLAN_LIMITS.${plan}.${key}=${JSON.stringify(value)} must be a ` +
            'non-negative number or null — ignored.',
        );
      }
    }
  }
  return merged;
}

/** UTC calendar month, e.g. '2026-07'. The counter "reset" is this rolling over. */
export function currentPeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export interface ResolvedEntitlements {
  plan: ResolvedPlan;
  byok: boolean;
  limits: PlanLimits;
}

export type LimitVerdict =
  | { allowed: true }
  | {
      allowed: false;
      metric: LimitMetric;
      limit: number;
      used: number;
      requested: number;
      plan: ResolvedPlan;
      /** What lifts this limit — feeds the client's upsell prompt. */
      upgrade: 'plus' | 'byok' | null;
    };

export interface EntitlementsDeps {
  enforced: boolean;
  exemptEmails: Set<string>;
  /** priceId → plan mapping, from billingConfig.prices. */
  prices: ReadonlyArray<{ id: string; plan: PlanId }>;
  planLimits: Record<PlanId, PlanLimits>;
  resolveEmail: (userId: string) => string | null;
  /** BYOK bolt-on flag — a seam until #223 lands per-user key storage. */
  isByok: (userId: string) => boolean;
  /**
   * Operator-granted complimentary tier (#221 comp), or null. A comped account
   * resolves to that tier's limits/models — the counterpart to the billing
   * gate bypassing it. Seam over lib/account-flags.getCompedPlan.
   */
  compedPlan: (userId: string) => PlanId | null;
  now: () => Date;
}

export interface EntitlementsEngine {
  resolveEntitlements(userId: string): ResolvedEntitlements;
  /**
   * The single enforcement helper (#222): may `userId` do `requested` more of
   * `metric` right now? Counter metrics compare against this month's usage;
   * library metrics count the live tables; phraseSelectionWords compares the
   * requested size against the cap directly.
   */
  checkLimit(userId: string, metric: LimitMetric, requested?: number): LimitVerdict;
  /** Record consumption AFTER the metered action succeeds. */
  recordUsage(userId: string, metric: LimitMetric, amount: number): void;
  getUsage(userId: string, metric: LimitMetric): number;
}

/**
 * Paddle subscription-status rank, most entitled first (same order as
 * lib/billing.ts resolveBillingStatus — an account with a canceled old sub
 * and an active new one must resolve by the active one).
 */
const STATUS_RANK: readonly string[] = ['active', 'trialing', 'past_due', 'paused', 'canceled'];

export function makeEntitlements(deps: EntitlementsDeps): EntitlementsEngine {
  const priceToPlan = new Map(deps.prices.map((p) => [p.id, p.plan]));

  function resolvePlan(userId: string): ResolvedPlan {
    if (!deps.enforced) return 'unlimited';
    const email = deps.resolveEmail(userId);
    if (email && deps.exemptEmails.has(email.toLowerCase())) return 'unlimited';

    // Operator-comped account (#221): its granted tier drives limits/models,
    // ahead of any real subscription (comp is deliberate, on the house).
    const comped = deps.compedPlan(userId);
    if (comped) return comped;

    // Same match rule as the billing gate: by tenant id (in-app checkout
    // stamps custom_data.lectorUserId) or by Paddle customer email.
    const rows = db
      .prepare(
        `SELECT s.status, s.priceId, s.occurredAt FROM billing_subscriptions s
         LEFT JOIN billing_customers c ON c.paddleCustomerId = s.paddleCustomerId
         WHERE s.userId = ? OR (? IS NOT NULL AND c.email = lower(?))`,
      )
      .all(userId, email, email) as Array<{
      status: string;
      priceId: string | null;
      occurredAt: string;
    }>;

    let best: (typeof rows)[number] | undefined;
    for (const row of rows) {
      if (!isEntitledStatus(row.status)) continue;
      if (!best) {
        best = row;
        continue;
      }
      const rank = STATUS_RANK.indexOf(row.status);
      const bestRank = STATUS_RANK.indexOf(best.status);
      if (rank < bestRank || (rank === bestRank && row.occurredAt > best.occurredAt)) {
        best = row;
      }
    }

    // No entitled subscription: the billing gate 402s such accounts before
    // any limited route runs, so this is defense-in-depth — give the
    // cheapest plan's limits rather than inventing a lockout of our own.
    if (!best) return 'cloud';

    // An entitled subscription whose price we can't map (price removed from
    // env, or a pre-#292 row without priceId) is still a paying customer:
    // default to the base plan's generous limits and let ops fix the config.
    return (best.priceId && priceToPlan.get(best.priceId)) || 'cloud';
  }

  function resolveEntitlements(userId: string): ResolvedEntitlements {
    const plan = resolvePlan(userId);
    if (plan === 'unlimited') return { plan, byok: false, limits: UNLIMITED };
    const byok = deps.isByok(userId);
    return { plan, byok, limits: byok ? BYOK_LIMITS : deps.planLimits[plan] };
  }

  function getUsage(userId: string, metric: LimitMetric): number {
    const row = db
      .prepare('SELECT value FROM usage_counters WHERE userId = ? AND metric = ? AND period = ?')
      .get(userId, metric, currentPeriod(deps.now())) as { value: number } | undefined;
    return row?.value ?? 0;
  }

  function recordUsage(userId: string, metric: LimitMetric, amount: number): void {
    if (amount <= 0) return;
    db.prepare(
      `INSERT INTO usage_counters (userId, metric, period, value, updatedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(userId, metric, period) DO UPDATE SET
         value = value + excluded.value,
         updatedAt = excluded.updatedAt`,
    ).run(userId, metric, currentPeriod(deps.now()), amount, new Date().toISOString());
  }

  function liveCount(userId: string, metric: 'maxCollections' | 'maxLessons'): number {
    const table = metric === 'maxCollections' ? 'collections' : 'lessons';
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM ${table} WHERE userId = ?`)
      .get(userId) as { count: number };
    return row.count;
  }

  function upgradeFor(plan: ResolvedPlan, metric: LimitMetric): 'plus' | 'byok' | null {
    if (plan === 'cloud') return 'plus';
    // Plus only caps the managed metered calls; BYOK lifts those.
    if (plan === 'plus' && METERED.includes(metric)) return 'byok';
    return null;
  }

  function checkLimit(userId: string, metric: LimitMetric, requested = 1): LimitVerdict {
    const { plan, limits } = resolveEntitlements(userId);
    const limit = limits[metric];
    if (limit === null) return { allowed: true };

    const used =
      metric === 'phraseSelectionWords'
        ? 0
        : metric === 'maxCollections' || metric === 'maxLessons'
          ? liveCount(userId, metric)
          : getUsage(userId, metric);

    if (used + requested <= limit) return { allowed: true };
    return { allowed: false, metric, limit, used, requested, plan, upgrade: upgradeFor(plan, metric) };
  }

  return { resolveEntitlements, checkLimit, recordUsage, getUsage };
}

let active: EntitlementsEngine = makeEntitlements({
  enforced: billingConfig.enforced,
  exemptEmails: billingConfig.exemptEmails,
  prices: billingConfig.prices,
  planLimits: parsePlanLimitOverrides(process.env.LECTOR_PLAN_LIMITS),
  resolveEmail: getUserEmail,
  // BYOK is not purchasable until #223 lands per-user key storage; the
  // engine honors the flag so #223 only has to flip this seam.
  isByok: () => false,
  compedPlan: getCompedPlan,
  now: () => new Date(),
});

/**
 * The prod engine, bound to the resolved billing config. A delegating facade
 * (not the bare object) so route tests can install a strict engine behind the
 * same import every route module already holds.
 */
export const entitlements: EntitlementsEngine = {
  resolveEntitlements: (userId) => active.resolveEntitlements(userId),
  checkLimit: (userId, metric, requested) => active.checkLimit(userId, metric, requested),
  recordUsage: (userId, metric, amount) => active.recordUsage(userId, metric, amount),
  getUsage: (userId, metric) => active.getUsage(userId, metric),
};

/** Test-only: swap the engine behind the facade; returns the restore function. */
export function setEntitlementsEngineForTests(engine: EntitlementsEngine): () => void {
  const prev = active;
  active = engine;
  return () => {
    active = prev;
  };
}

/**
 * The one over-limit response shape. 429 (not 402 — that means "not
 * subscribed" and hard-navigates to /subscribe): the client turns
 * error:'plan_limit' into a soft upsell prompt, not an error wall.
 */
export function planLimitResponse(c: Context, verdict: Exclude<LimitVerdict, { allowed: true }>) {
  return c.json(
    {
      error: 'plan_limit' as const,
      metric: verdict.metric,
      limit: verdict.limit,
      used: verdict.used,
      requested: verdict.requested,
      plan: verdict.plan,
      upgrade: verdict.upgrade,
    },
    429,
  );
}

/**
 * Convenience middleware for whole-route caps (single metric, fixed cost).
 * Routes that need request-dependent amounts (journal word counts, TTS
 * characters, phrase length) call checkLimit/recordUsage inline instead.
 */
export function limitGuard(metric: LimitMetric, engine: EntitlementsEngine = entitlements) {
  return createMiddleware(async (c, next) => {
    const userId = c.get('userId');
    if (typeof userId !== 'string' || userId.length === 0) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    const verdict = engine.checkLimit(userId, metric);
    if (!verdict.allowed) return planLimitResponse(c, verdict);
    return next();
  });
}
