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
 *   - Account status comes from #224's mirror: past_due keeps paid grace;
 *     never-subscribed/paused/canceled accounts derive Free only when the
 *     strict rollout flag is enabled. No Paddle "Free" row exists.
 *   - Counters key on explicit UTC day/month periods; resets are the key
 *     rolling over. Counters are metering, not bookkeeping: checks
 *     happen before the metered action, increments after it succeeds, so a
 *     failed LLM call never burns allowance.
 *   - BYOK (#223) is honored as an AI funding source with high abuse ceilings.
 *     Free retains its product/storage caps and zero managed TTS; paid BYOK
 *     preserves existing product-cap behavior but also keeps plan-owned TTS.
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
import { hasByokCredential } from './byok';

export type PaidPlanId = 'cloud' | 'plus';
export type PlanId = 'free' | PaidPlanId;
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
  /** Fair-use ceiling: language-agnostic collection groups. */
  maxCollectionGroups: number | null;
  /** Fair-use ceiling: saved vocabulary rows. */
  maxVocabEntries: number | null;
  /** Fair-use ceiling: word-state rows across languages. */
  maxKnownWords: number | null;
  /** Fair-use ceiling: mined/bundled practice sentences. */
  maxClozeSentences: number | null;
  /** Fair-use ceiling: user-accepted dictionary-cache parents. */
  maxAcceptedDictionaryEntries: number | null;
  /** UTF-8 bytes across accepted dictionary parents, senses, and related forms. */
  maxAcceptedDictionaryBytesTotal: number | null;
  /** Fair-use ceiling: per-language calendar-day activity rows. */
  maxDailyStatsRows: number | null;
  /** Fair-use ceiling: journal rows (including empty drafts). */
  maxJournalEntries: number | null;
  /** Fair-use ceiling: personal API tokens. */
  maxApiTokens: number | null;
  /** UTF-8 bytes in one personal API-token name. */
  maxApiTokenNameBytes: number | null;
  /** Fair-use ceiling: durable Anki addon queue rows. */
  maxAnkiPendingRows: number | null;
  /** UTF-8 bytes in one Anki queue row's override fields. */
  maxAnkiPendingEntryBytes: number | null;
  /** UTF-8 bytes across Anki queue override fields. */
  maxAnkiPendingTextBytesTotal: number | null;
  /** UTF-8 bytes in one lesson title + body. */
  maxLessonTextBytes: number | null;
  /** UTF-8 bytes across all lesson titles + bodies. */
  maxLessonTextBytesTotal: number | null;
  /** UTF-8 bytes in one vocabulary row's learner-authored text fields. */
  maxVocabEntryBytes: number | null;
  /** UTF-8 bytes across vocabulary learner-authored text fields. */
  maxVocabTextBytesTotal: number | null;
  /** UTF-8 bytes in one known-word key. */
  maxKnownWordBytes: number | null;
  /** UTF-8 bytes across known-word keys. */
  maxKnownWordsTextBytesTotal: number | null;
  /** UTF-8 bytes in one cloze row's learner-authored text fields. */
  maxClozeEntryBytes: number | null;
  /** UTF-8 bytes across cloze learner-authored text fields. */
  maxClozeTextBytesTotal: number | null;
  /** UTF-8 bytes in one collection-group name. */
  maxGroupNameBytes: number | null;
  /** UTF-8 bytes in one collection's title/author/cover metadata. */
  maxCollectionMetadataBytes: number | null;
  /** UTF-8 bytes in one journal row, including correction output. */
  maxJournalEntryBytes: number | null;
  /** UTF-8 bytes across all journal bodies and correction output. */
  maxJournalTextBytesTotal: number | null;
  /** Positive learner-content growth accepted by one structured bulk write. */
  maxWriteBatchBytes: number | null;
  /** Managed-key LLM requests per month. */
  llmRequestsPerMonth: number | null;
  /** Managed-key TTS characters per month. */
  ttsCharsPerMonth: number | null;
  /** Contextual dictionary misses served by a managed model per UTC month. */
  wordGlossesPerMonth: number | null;
  /** Simple phrase translations per UTC day (paid rich calls use the shared LLM pool). */
  phraseTranslationsPerDay: number | null;
  /** Simple word-in-context translations per UTC day (paid rich calls use the shared LLM pool). */
  contextTranslationsPerDay: number | null;
}

/** Test/config convenience for plans that deliberately leave the Free-only
 * fair-use storage layer uncapped. Production Free uses finite values below. */
export const NO_STORAGE_LIMITS = {
  maxCollectionGroups: null,
  maxVocabEntries: null,
  maxKnownWords: null,
  maxClozeSentences: null,
  maxAcceptedDictionaryEntries: null,
  maxAcceptedDictionaryBytesTotal: null,
  maxDailyStatsRows: null,
  maxJournalEntries: null,
  maxApiTokens: null,
  maxApiTokenNameBytes: null,
  maxAnkiPendingRows: null,
  maxAnkiPendingEntryBytes: null,
  maxAnkiPendingTextBytesTotal: null,
  maxLessonTextBytes: null,
  maxLessonTextBytesTotal: null,
  maxVocabEntryBytes: null,
  maxVocabTextBytesTotal: null,
  maxKnownWordBytes: null,
  maxKnownWordsTextBytesTotal: null,
  maxClozeEntryBytes: null,
  maxClozeTextBytesTotal: null,
  maxGroupNameBytes: null,
  maxCollectionMetadataBytes: null,
  maxJournalEntryBytes: null,
  maxJournalTextBytesTotal: null,
  maxWriteBatchBytes: null,
} as const;

export type LimitMetric = keyof PlanLimits;

export const METRIC_WINDOW = {
  journalWordsPerMonth: 'month',
  llmRequestsPerMonth: 'month',
  ttsCharsPerMonth: 'month',
  wordGlossesPerMonth: 'month',
  phraseTranslationsPerDay: 'day',
  contextTranslationsPerDay: 'day',
} as const satisfies Partial<Record<LimitMetric, 'day' | 'month'>>;

export type MeteredMetric = keyof typeof METRIC_WINDOW;

export type LiveLimitMetric =
  | 'maxCollections'
  | 'maxLessons'
  | 'maxCollectionGroups'
  | 'maxVocabEntries'
  | 'maxKnownWords'
  | 'maxClozeSentences'
  | 'maxAcceptedDictionaryEntries'
  | 'maxDailyStatsRows'
  | 'maxJournalEntries'
  | 'maxApiTokens'
  | 'maxAnkiPendingRows'
  | 'maxLessonTextBytesTotal'
  | 'maxVocabTextBytesTotal'
  | 'maxKnownWordsTextBytesTotal'
  | 'maxClozeTextBytesTotal'
  | 'maxAcceptedDictionaryBytesTotal'
  | 'maxAnkiPendingTextBytesTotal'
  | 'maxJournalTextBytesTotal';

export interface AtomicLimitCheck {
  metric: LimitMetric;
  requested?: number;
}

/**
 * Per-plan limit values (#216 "Pricing model", #222 table). Paid ceilings are
 * deliberately generous: an ordinary paid learner should never see them —
 * they route heavy managed-key use to BYOK/Plus and bound tail-risk API cost.
 */
const DEFAULT_PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    phraseSelectionWords: 6,
    journalWordsPerMonth: 1_000,
    maxCollections: 10,
    maxLessons: 200,
    // These are deliberately generous abuse/fair-use ceilings, not normal
    // product limits. Together with byte caps they put a finite upper bound on
    // a Free tenant without getting in the way of ordinary long-term learning.
    maxCollectionGroups: 50,
    maxVocabEntries: 10_000,
    maxKnownWords: 25_000,
    // Roughly two to three complete bundled language banks. Learners can delete
    // an old bank before seeding another language; vocabulary remains portable.
    maxClozeSentences: 25_000,
    maxAcceptedDictionaryEntries: 1_000,
    maxAcceptedDictionaryBytesTotal: 2 * 1024 * 1024,
    maxDailyStatsRows: 5_000,
    maxJournalEntries: 5_000,
    maxApiTokens: 20,
    maxApiTokenNameBytes: 128,
    maxAnkiPendingRows: 2_000,
    maxAnkiPendingEntryBytes: 16 * 1024,
    maxAnkiPendingTextBytesTotal: 4 * 1024 * 1024,
    // Exported learner-authored TEXT totals 17.5 MiB at all aggregate caps.
    // The serialized proof additionally budgets 2x JSON escaping, every field
    // name/row/128-byte id, metadata, settings, and all dictionary children:
    // 93,009,446 bytes inside the Cloudflare-safe 90 MiB restore envelope.
    maxLessonTextBytes: 1024 * 1024,
    maxLessonTextBytesTotal: 5 * 1024 * 1024,
    maxVocabEntryBytes: 16 * 1024,
    maxVocabTextBytesTotal: 1536 * 1024,
    maxKnownWordBytes: 256,
    maxKnownWordsTextBytesTotal: 512 * 1024,
    maxClozeEntryBytes: 16 * 1024,
    maxClozeTextBytesTotal: 8 * 1024 * 1024,
    maxGroupNameBytes: 1024,
    maxCollectionMetadataBytes: 8 * 1024,
    maxJournalEntryBytes: 64 * 1024,
    maxJournalTextBytesTotal: 512 * 1024,
    maxWriteBatchBytes: 2 * 1024 * 1024,
    llmRequestsPerMonth: 0,
    ttsCharsPerMonth: 0,
    wordGlossesPerMonth: 1_000,
    phraseTranslationsPerDay: 10,
    contextTranslationsPerDay: 10,
  },
  cloud: {
    phraseSelectionWords: 9,
    journalWordsPerMonth: 5_000,
    maxCollections: 50,
    maxLessons: 1_000,
    maxCollectionGroups: null,
    maxVocabEntries: null,
    maxKnownWords: null,
    maxClozeSentences: null,
    maxAcceptedDictionaryEntries: null,
    maxAcceptedDictionaryBytesTotal: null,
    maxDailyStatsRows: null,
    maxJournalEntries: null,
    maxApiTokens: null,
    maxApiTokenNameBytes: null,
    maxAnkiPendingRows: null,
    maxAnkiPendingEntryBytes: null,
    maxAnkiPendingTextBytesTotal: null,
    maxLessonTextBytes: null,
    maxLessonTextBytesTotal: null,
    maxVocabEntryBytes: null,
    maxVocabTextBytesTotal: null,
    maxKnownWordBytes: null,
    maxKnownWordsTextBytesTotal: null,
    maxClozeEntryBytes: null,
    maxClozeTextBytesTotal: null,
    maxGroupNameBytes: null,
    maxCollectionMetadataBytes: null,
    maxJournalEntryBytes: null,
    maxJournalTextBytesTotal: null,
    maxWriteBatchBytes: null,
    llmRequestsPerMonth: 5_000,
    ttsCharsPerMonth: 300_000,
    wordGlossesPerMonth: 10_000,
    phraseTranslationsPerDay: null,
    contextTranslationsPerDay: null,
  },
  plus: {
    phraseSelectionWords: null,
    journalWordsPerMonth: null,
    maxCollections: null,
    maxLessons: null,
    maxCollectionGroups: null,
    maxVocabEntries: null,
    maxKnownWords: null,
    maxClozeSentences: null,
    maxAcceptedDictionaryEntries: null,
    maxAcceptedDictionaryBytesTotal: null,
    maxDailyStatsRows: null,
    maxJournalEntries: null,
    maxApiTokens: null,
    maxApiTokenNameBytes: null,
    maxAnkiPendingRows: null,
    maxAnkiPendingEntryBytes: null,
    maxAnkiPendingTextBytesTotal: null,
    maxLessonTextBytes: null,
    maxLessonTextBytesTotal: null,
    maxVocabEntryBytes: null,
    maxVocabTextBytesTotal: null,
    maxKnownWordBytes: null,
    maxKnownWordsTextBytesTotal: null,
    maxClozeEntryBytes: null,
    maxClozeTextBytesTotal: null,
    maxGroupNameBytes: null,
    maxCollectionMetadataBytes: null,
    maxJournalEntryBytes: null,
    maxJournalTextBytesTotal: null,
    maxWriteBatchBytes: null,
    llmRequestsPerMonth: 20_000,
    ttsCharsPerMonth: 1_500_000,
    wordGlossesPerMonth: 50_000,
    phraseTranslationsPerDay: null,
    contextTranslationsPerDay: null,
  },
};

function isFreeFairUseCeiling(metric: string): metric is LimitMetric {
  return metric.startsWith('max');
}

/**
 * Build BYOK limits from the underlying plan. A user key pays for AI, not
 * Google's managed TTS, so TTS always stays at the plan's allowance. Free
 * BYOK is an escape hatch for rich AI while its non-AI product/storage caps
 * remain intact; paid BYOK preserves the existing product-cap lift.
 */
function byokLimits(plan: PlanId, base: PlanLimits): PlanLimits {
  const free = plan === 'free';
  return {
    ...base,
    phraseSelectionWords: null,
    journalWordsPerMonth: free ? base.journalWordsPerMonth : null,
    maxCollections: free ? base.maxCollections : null,
    maxLessons: free ? base.maxLessons : null,
    llmRequestsPerMonth: 50_000,
    ttsCharsPerMonth: base.ttsCharsPerMonth,
    wordGlossesPerMonth: 100_000,
    phraseTranslationsPerDay: null,
    contextTranslationsPerDay: null,
  };
}

const UNLIMITED: PlanLimits = {
  phraseSelectionWords: null,
  journalWordsPerMonth: null,
  maxCollections: null,
  maxLessons: null,
  maxCollectionGroups: null,
  maxVocabEntries: null,
  maxKnownWords: null,
  maxClozeSentences: null,
  maxAcceptedDictionaryEntries: null,
  maxAcceptedDictionaryBytesTotal: null,
  maxDailyStatsRows: null,
  maxJournalEntries: null,
  maxApiTokens: null,
  maxApiTokenNameBytes: null,
  maxAnkiPendingRows: null,
  maxAnkiPendingEntryBytes: null,
  maxAnkiPendingTextBytesTotal: null,
  maxLessonTextBytes: null,
  maxLessonTextBytesTotal: null,
  maxVocabEntryBytes: null,
  maxVocabTextBytesTotal: null,
  maxKnownWordBytes: null,
  maxKnownWordsTextBytesTotal: null,
  maxClozeEntryBytes: null,
  maxClozeTextBytesTotal: null,
  maxGroupNameBytes: null,
  maxCollectionMetadataBytes: null,
  maxJournalEntryBytes: null,
  maxJournalTextBytesTotal: null,
  maxWriteBatchBytes: null,
  llmRequestsPerMonth: null,
  ttsCharsPerMonth: null,
  wordGlossesPerMonth: null,
  phraseTranslationsPerDay: null,
  contextTranslationsPerDay: null,
};

/**
 * Merge LECTOR_PLAN_LIMITS over the defaults: a JSON object keyed by plan,
 * values partial PlanLimits (non-negative numbers, or null for uncapped paid
 * tiers). Lets a deployment tune tiers without a code change, e.g.
 *   LECTOR_PLAN_LIMITS='{"cloud":{"journalWordsPerMonth":8000}}'
 * Hosted Free overrides must remain finite; `max*` fair-use values may be
 * lowered but not raised above the defaults used by the 90 MiB portability
 * proof. Its rich managed-LLM and managed TTS pools are fixed at zero.
 * Unknown plans/keys and non-numeric values are ignored with a warning —
 * a typo must never silently zero someone's allowance.
 */
export function parsePlanLimitOverrides(
  raw: string | undefined,
  defaults: Record<PlanId, PlanLimits> = DEFAULT_PLAN_LIMITS,
): Record<PlanId, PlanLimits> {
  const merged: Record<PlanId, PlanLimits> = {
    free: { ...defaults.free },
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
    if (plan !== 'free' && plan !== 'cloud' && plan !== 'plus') {
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
      if (plan === 'free' && value === null) {
        console.warn(
          `[entitlements] LECTOR_PLAN_LIMITS.free.${key} must stay finite on hosted Free ` +
            '— null override ignored.',
        );
        continue;
      }
      if (
        plan === 'free' &&
        (key === 'ttsCharsPerMonth' || key === 'llmRequestsPerMonth') &&
        value !== 0
      ) {
        console.warn(
          `[entitlements] LECTOR_PLAN_LIMITS.free.${key} is fixed at 0 ` +
            '(Free uses BYOK for rich AI and browser speech for audio) — override ignored.',
        );
        continue;
      }
      if (
        plan === 'free' &&
        isFreeFairUseCeiling(key) &&
        typeof value === 'number' &&
        value > (DEFAULT_PLAN_LIMITS.free[key] as number)
      ) {
        console.warn(
          `[entitlements] LECTOR_PLAN_LIMITS.free.${key} cannot exceed the ` +
            'portable Free ceiling — override ignored.',
        );
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

/** UTC calendar day, e.g. '2026-07-15'. */
export function currentDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface EntitlementPeriods {
  day: string;
  month: string;
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
      upgrade: 'cloud' | 'plus' | 'byok' | null;
    };

/**
 * Opaque proof of one successful metered reservation. Callers retain and pass
 * it back to refund() if the provider operation fails; its exact period keeps
 * a request crossing UTC midnight from refunding the wrong counter row.
 */
export interface UsageReservation {
  readonly userId: string;
  readonly metric: MeteredMetric;
  readonly amount: number;
  readonly period: string;
  /** Provider mode used for the limit decision; must be honored by getProvider. */
  readonly byok: boolean;
}

export type ReservationVerdict =
  | { allowed: true; reservation: UsageReservation }
  | Exclude<LimitVerdict, { allowed: true }>;

export interface EntitlementsDeps {
  enforced: boolean;
  freeTierEnabled: boolean;
  exemptEmails: Set<string>;
  /** priceId → plan mapping, from billingConfig.prices. */
  prices: ReadonlyArray<{ id: string; plan: PaidPlanId }>;
  planLimits: Record<PlanId, PlanLimits>;
  resolveEmail: (userId: string) => string | null;
  /** Whether this account currently has a readable per-user provider credential. */
  isByok: (userId: string) => boolean;
  /**
   * Operator-granted complimentary tier (#221 comp), or null. A comped account
   * resolves to that tier's limits/models — the counterpart to the billing
   * gate bypassing it. Seam over lib/account-flags.getCompedPlan.
   */
  compedPlan: (userId: string) => PaidPlanId | null;
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
  recordUsage(userId: string, metric: MeteredMetric, amount: number): void;
  /**
   * Atomic check-and-record for a counter metric — reserve BEFORE a provider
   * call, refund() if it fails. Closes the check-then-write race (#222 review).
   */
  reserve(userId: string, metric: MeteredMetric, amount?: number): ReservationVerdict;
  /** Undo a reserve() when the metered action fails. Clamped at zero. */
  refund(reservation: UsageReservation): void;
  /**
   * Atomic check-and-write for live row/byte limits and direct payload caps:
   * runs `commit` inside the same write transaction, only if every check
   * passes. The historical name remains to avoid churn at existing callers.
   */
  reserveCount(
    userId: string,
    checks: ReadonlyArray<AtomicLimitCheck>,
    commit: () => void,
  ): LimitVerdict;
  getUsage(userId: string, metric: MeteredMetric, periods?: EntitlementPeriods): number;
  /** Periods derived from the same injected clock used for metering. */
  currentPeriods(): EntitlementPeriods;
}

/**
 * Plan tiers ranked by entitlement, most generous first. When a user holds
 * more than one ENTITLED subscription (e.g. an active Cloud and an active
 * Plus), the most generous tier must win — never merely the most recent (#222
 * review): ranking entitled rows by status/recency alone let a newer Cloud sub
 * shadow an older Plus one and wrongly apply Cloud limits.
 */
const PLAN_RANK: Record<PaidPlanId, number> = { plus: 2, cloud: 1 };

export function makeEntitlements(deps: EntitlementsDeps): EntitlementsEngine {
  const priceToPlan = new Map(deps.prices.map((p) => [p.id, p.plan]));

  function currentPeriods(): EntitlementPeriods {
    const now = deps.now();
    return { day: currentDay(now), month: currentPeriod(now) };
  }

  function periodFor(metric: MeteredMetric, now: Date = deps.now()): string {
    return METRIC_WINDOW[metric] === 'day' ? currentDay(now) : currentPeriod(now);
  }

  function isMeteredMetric(metric: LimitMetric): metric is MeteredMetric {
    return metric in METRIC_WINDOW;
  }

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
        `SELECT s.status, s.priceId FROM billing_subscriptions s
         LEFT JOIN billing_customers c ON c.paddleCustomerId = s.paddleCustomerId
         WHERE s.userId = ? OR (? IS NOT NULL AND c.email = lower(?))`,
      )
      .all(userId, email, email) as Array<{ status: string; priceId: string | null }>;

    // Resolve to the MOST ENTITLED tier across all entitled subscriptions —
    // not the newest row. An entitled sub whose price we can't map (removed
    // from env, or a pre-#292 row without priceId) is still a paying customer,
    // so it counts as the base plan.
    let best: PaidPlanId | null = null;
    for (const row of rows) {
      if (!isEntitledStatus(row.status)) continue;
      const plan = (row.priceId && priceToPlan.get(row.priceId)) || 'cloud';
      if (best === null || PLAN_RANK[plan] > PLAN_RANK[best]) best = plan;
    }

    // Free is derived, never mirrored as a Paddle product. With the rollout
    // flag off, retain the old Cloud fallback because billing middleware locks
    // this state before limited routes run.
    return best ?? (deps.freeTierEnabled ? 'free' : 'cloud');
  }

  function resolveEntitlements(userId: string): ResolvedEntitlements {
    const plan = resolvePlan(userId);
    if (plan === 'unlimited') return { plan, byok: false, limits: UNLIMITED };
    const byok = deps.isByok(userId);
    const configured = deps.planLimits[plan];
    // Product invariant, not merely a launch default: hosted Free is always
    // finite, rich managed AI is BYOK-only, and speech is browser-only. Defend
    // even injected/custom tables (not only env parsing) by replacing nulls
    // with the production Free defaults and pinning both managed pools to zero.
    const base =
      plan === 'free'
        ? (Object.fromEntries(
            (Object.keys(DEFAULT_PLAN_LIMITS.free) as LimitMetric[]).map((metric) => [
              metric,
              typeof configured[metric] === 'number' &&
              Number.isFinite(configured[metric]) &&
              configured[metric] >= 0
                ? isFreeFairUseCeiling(metric)
                  ? Math.min(
                      configured[metric] as number,
                      DEFAULT_PLAN_LIMITS.free[metric] as number,
                    )
                  : configured[metric]
                : DEFAULT_PLAN_LIMITS.free[metric],
            ]),
          ) as unknown as PlanLimits)
        : configured;
    if (plan === 'free') {
      base.llmRequestsPerMonth = 0;
      base.ttsCharsPerMonth = 0;
    }
    return { plan, byok, limits: byok ? byokLimits(plan, base) : base };
  }

  function getUsageAtPeriod(userId: string, metric: MeteredMetric, period: string): number {
    const row = db
      .prepare('SELECT value FROM usage_counters WHERE userId = ? AND metric = ? AND period = ?')
      .get(userId, metric, period) as { value: number } | undefined;
    return row?.value ?? 0;
  }

  function getUsage(
    userId: string,
    metric: MeteredMetric,
    periods: EntitlementPeriods = currentPeriods(),
  ): number {
    const period = METRIC_WINDOW[metric] === 'day' ? periods.day : periods.month;
    return getUsageAtPeriod(userId, metric, period);
  }

  function recordUsageAtPeriod(
    userId: string,
    metric: MeteredMetric,
    amount: number,
    period: string,
    updatedAt: string,
  ): void {
    if (amount <= 0) return;
    db.prepare(
      `INSERT INTO usage_counters (userId, metric, period, value, updatedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(userId, metric, period) DO UPDATE SET
         value = value + excluded.value,
         updatedAt = excluded.updatedAt`,
    ).run(userId, metric, period, amount, updatedAt);
  }

  function recordUsage(userId: string, metric: MeteredMetric, amount: number): void {
    const now = deps.now();
    recordUsageAtPeriod(userId, metric, amount, periodFor(metric, now), now.toISOString());
  }

  /**
   * Undo a reservation when the metered action fails after we reserved for it.
   * Clamped at zero so a double-refund or clock skew can't drive a counter
   * negative.
   */
  function refund(reservation: UsageReservation): void {
    if (reservation.amount <= 0) return;
    db.prepare(
      `UPDATE usage_counters SET value = MAX(0, value - ?), updatedAt = ?
       WHERE userId = ? AND metric = ? AND period = ?`,
    ).run(
      reservation.amount,
      deps.now().toISOString(),
      reservation.userId,
      reservation.metric,
      reservation.period,
    );
  }

  /**
   * Atomically check a counter metric and, if allowed, record the usage in the
   * SAME synchronous step (no `await` between check and write, so two
   * concurrent requests can't both pass at `limit - 1`). Callers reserve
   * BEFORE the provider call and refund() if it fails — closing the
   * check-then-write race that could bill unlimited managed calls (#222 review).
   */
  function reserve(userId: string, metric: MeteredMetric, amount = 1): ReservationVerdict {
    const now = deps.now();
    const period = periodFor(metric, now);
    const resolved = resolveEntitlements(userId);
    const verdict = checkLimitAtPeriod(userId, metric, amount, period, resolved);
    if (!verdict.allowed) return verdict;
    recordUsageAtPeriod(userId, metric, amount, period, now.toISOString());
    return {
      allowed: true,
      reservation: { userId, metric, amount, period, byok: resolved.byok },
    };
  }

  /**
   * Enforce live row/byte limits and direct payload caps, then run `commit`
   * inside the SAME write transaction. This closes count/SUM-then-write races
   * and rolls the check back if the write throws. `commit` runs only when every
   * check passes; the returned verdict tells the caller whether it did.
   */
  function reserveCount(
    userId: string,
    checks: ReadonlyArray<AtomicLimitCheck>,
    commit: () => void,
  ): LimitVerdict {
    return db.transaction((): LimitVerdict => {
      for (const { metric, requested } of checks) {
        const verdict = checkLimit(userId, metric, requested);
        if (!verdict.allowed) return verdict;
      }
      commit();
      return { allowed: true };
    })();
  }

  function scalarUsage(sql: string, userId: string): number {
    const row = db.prepare(sql).get(userId) as { used: number | null };
    return row.used ?? 0;
  }

  function liveUsage(userId: string, metric: LiveLimitMetric): number {
    switch (metric) {
      case 'maxCollections':
        return scalarUsage('SELECT COUNT(*) AS used FROM collections WHERE userId = ?', userId);
      case 'maxLessons':
        return scalarUsage('SELECT COUNT(*) AS used FROM lessons WHERE userId = ?', userId);
      case 'maxCollectionGroups':
        return scalarUsage(
          'SELECT COUNT(*) AS used FROM collection_groups WHERE userId = ?',
          userId,
        );
      case 'maxVocabEntries':
        return scalarUsage('SELECT COUNT(*) AS used FROM vocab WHERE userId = ?', userId);
      case 'maxKnownWords':
        return scalarUsage('SELECT COUNT(*) AS used FROM knownWords WHERE userId = ?', userId);
      case 'maxClozeSentences':
        return scalarUsage('SELECT COUNT(*) AS used FROM clozeSentences WHERE userId = ?', userId);
      case 'maxAcceptedDictionaryEntries':
        return scalarUsage('SELECT COUNT(*) AS used FROM cached_entries WHERE userId = ?', userId);
      case 'maxDailyStatsRows':
        return scalarUsage('SELECT COUNT(*) AS used FROM dailyStats WHERE userId = ?', userId);
      case 'maxJournalEntries':
        return scalarUsage('SELECT COUNT(*) AS used FROM journal_entries WHERE userId = ?', userId);
      case 'maxApiTokens':
        return scalarUsage('SELECT COUNT(*) AS used FROM api_tokens WHERE userId = ?', userId);
      case 'maxAnkiPendingRows':
        return scalarUsage('SELECT COUNT(*) AS used FROM anki_pending WHERE userId = ?', userId);
      case 'maxLessonTextBytesTotal':
        return scalarUsage(
          `SELECT COALESCE(SUM(
             length(CAST(title AS BLOB)) + length(CAST(textContent AS BLOB))
           ), 0) AS used
             FROM lessons WHERE userId = ?`,
          userId,
        );
      case 'maxVocabTextBytesTotal':
        return scalarUsage(
          `SELECT COALESCE(SUM(
             length(CAST(text AS BLOB)) + length(CAST(sentence AS BLOB)) +
             length(CAST(translation AS BLOB))
           ), 0) AS used FROM vocab WHERE userId = ?`,
          userId,
        );
      case 'maxKnownWordsTextBytesTotal':
        return scalarUsage(
          `SELECT COALESCE(SUM(length(CAST(word AS BLOB))), 0) AS used
             FROM knownWords WHERE userId = ?`,
          userId,
        );
      case 'maxClozeTextBytesTotal':
        return scalarUsage(
          `SELECT COALESCE(SUM(
             length(CAST(sentence AS BLOB)) + length(CAST(clozeWord AS BLOB)) +
             length(CAST(translation AS BLOB))
           ), 0) AS used FROM clozeSentences WHERE userId = ?`,
          userId,
        );
      case 'maxAcceptedDictionaryBytesTotal': {
        const parents = scalarUsage(
          `SELECT COALESCE(SUM(
             length(CAST(word AS BLOB)) + length(CAST(COALESCE(ipa, '') AS BLOB)) +
             length(CAST(COALESCE(etymology, '') AS BLOB)) +
             length(CAST(COALESCE(sourceSentence, '') AS BLOB))
           ), 0) AS used FROM cached_entries WHERE userId = ?`,
          userId,
        );
        const senses = scalarUsage(
          `SELECT COALESCE(SUM(
             length(CAST(COALESCE(pos, '') AS BLOB)) + length(CAST(gloss AS BLOB))
           ), 0) AS used FROM cached_senses WHERE userId = ?`,
          userId,
        );
        const related = scalarUsage(
          `SELECT COALESCE(SUM(
             length(CAST(related_word AS BLOB)) + length(CAST(relation AS BLOB))
           ), 0) AS used FROM cached_related_forms WHERE userId = ?`,
          userId,
        );
        return parents + senses + related;
      }
      case 'maxJournalTextBytesTotal':
        return scalarUsage(
          `SELECT COALESCE(SUM(
             length(CAST(body AS BLOB)) +
             length(CAST(COALESCE(correctedBody, '') AS BLOB)) +
             length(CAST(COALESCE(corrections, '') AS BLOB))
           ), 0) AS used FROM journal_entries WHERE userId = ?`,
          userId,
        );
      case 'maxAnkiPendingTextBytesTotal':
        return scalarUsage(
          `SELECT COALESCE(SUM(
             length(CAST(COALESCE(word, '') AS BLOB)) +
             length(CAST(COALESCE(sentence, '') AS BLOB)) +
             length(CAST(COALESCE(translation, '') AS BLOB)) +
             length(CAST(COALESCE(meaning, '') AS BLOB))
           ), 0) AS used FROM anki_pending WHERE userId = ?`,
          userId,
        );
    }
  }

  const LIVE_LIMIT_METRICS = new Set<LimitMetric>([
    'maxCollections',
    'maxLessons',
    'maxCollectionGroups',
    'maxVocabEntries',
    'maxKnownWords',
    'maxClozeSentences',
    'maxAcceptedDictionaryEntries',
    'maxDailyStatsRows',
    'maxJournalEntries',
    'maxApiTokens',
    'maxAnkiPendingRows',
    'maxLessonTextBytesTotal',
    'maxVocabTextBytesTotal',
    'maxKnownWordsTextBytesTotal',
    'maxClozeTextBytesTotal',
    'maxAcceptedDictionaryBytesTotal',
    'maxJournalTextBytesTotal',
    'maxAnkiPendingTextBytesTotal',
  ]);

  const DIRECT_SIZE_METRICS = new Set<LimitMetric>([
    'phraseSelectionWords',
    'maxLessonTextBytes',
    'maxVocabEntryBytes',
    'maxKnownWordBytes',
    'maxClozeEntryBytes',
    'maxGroupNameBytes',
    'maxCollectionMetadataBytes',
    'maxJournalEntryBytes',
    'maxApiTokenNameBytes',
    'maxAnkiPendingEntryBytes',
    'maxWriteBatchBytes',
  ]);

  const AI_METRICS = new Set<LimitMetric>([
    'phraseSelectionWords',
    'llmRequestsPerMonth',
    'wordGlossesPerMonth',
    'phraseTranslationsPerDay',
    'contextTranslationsPerDay',
  ]);

  function upgradeFor(
    resolved: ResolvedEntitlements,
    metric: LimitMetric,
  ): 'cloud' | 'plus' | 'byok' | null {
    // A BYOK ceiling is an abuse guard, not managed capacity that buying a
    // plan would lift. Product/storage and managed TTS limits still upsell.
    if (resolved.byok && AI_METRICS.has(metric)) return null;
    if (resolved.plan === 'free') return 'cloud';
    if (resolved.plan === 'cloud') return 'plus';
    // Plus BYOK can lift only model-backed limits. It does not pay for TTS or
    // lift journal/library product limits.
    if (resolved.plan === 'plus' && AI_METRICS.has(metric)) return 'byok';
    return null;
  }

  function checkLimitAtPeriod(
    userId: string,
    metric: LimitMetric,
    requested: number,
    period?: string,
    resolved: ResolvedEntitlements = resolveEntitlements(userId),
  ): LimitVerdict {
    const limit = resolved.limits[metric];
    if (limit === null) return { allowed: true };
    // A same-key update at a row cap, or any content-shrinking edit while a
    // downgraded/legacy account remains over a byte ceiling, must stay usable.
    if (requested <= 0) return { allowed: true };

    const used = DIRECT_SIZE_METRICS.has(metric)
      ? 0
      : LIVE_LIMIT_METRICS.has(metric)
        ? liveUsage(userId, metric as LiveLimitMetric)
        : isMeteredMetric(metric)
          ? getUsageAtPeriod(userId, metric, period ?? periodFor(metric))
          : 0;

    if (used + requested <= limit) return { allowed: true };
    return {
      allowed: false,
      metric,
      limit,
      used,
      requested,
      plan: resolved.plan,
      upgrade: upgradeFor(resolved, metric),
    };
  }

  function checkLimit(userId: string, metric: LimitMetric, requested = 1): LimitVerdict {
    return checkLimitAtPeriod(userId, metric, requested);
  }

  return {
    resolveEntitlements,
    checkLimit,
    recordUsage,
    reserve,
    refund,
    reserveCount,
    getUsage,
    currentPeriods,
  };
}

let active: EntitlementsEngine = makeEntitlements({
  enforced: billingConfig.enforced,
  freeTierEnabled: billingConfig.freeTierEnabled,
  exemptEmails: billingConfig.exemptEmails,
  prices: billingConfig.prices,
  planLimits: parsePlanLimitOverrides(process.env.LECTOR_PLAN_LIMITS),
  resolveEmail: getUserEmail,
  isByok: hasByokCredential,
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
  reserve: (userId, metric, amount) => active.reserve(userId, metric, amount),
  refund: (reservation) => active.refund(reservation),
  reserveCount: (userId, checks, commit) => active.reserveCount(userId, checks, commit),
  getUsage: (userId, metric, periods) => active.getUsage(userId, metric, periods),
  currentPeriods: () => active.currentPeriods(),
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
