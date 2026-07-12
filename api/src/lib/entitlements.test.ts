import '../test-guard';
import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import path from 'path';
import { db } from '../db';
import {
  currentDay,
  currentPeriod,
  makeEntitlements,
  NO_STORAGE_LIMITS,
  parsePlanLimitOverrides,
  type EntitlementsDeps,
  type PlanId,
  type PlanLimits,
} from './entitlements';

// Engine unit tests (#222) — boundaries per the issue's "Done when".
// Uses the real test DB (usage_counters + billing mirror tables) with
// namespaced user ids so it can't collide with the billing suite.

const CLOUD_PRICE = 'pri_ent_cloud';
const PLUS_PRICE = 'pri_ent_plus';

const LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    ...NO_STORAGE_LIMITS,
    phraseSelectionWords: 6,
    journalWordsPerMonth: 20,
    maxCollections: 1,
    maxLessons: 2,
    llmRequestsPerMonth: 0,
    ttsCharsPerMonth: 0,
    wordGlossesPerMonth: 3,
    phraseTranslationsPerDay: 2,
    contextTranslationsPerDay: 2,
  },
  cloud: {
    ...NO_STORAGE_LIMITS,
    phraseSelectionWords: 9,
    journalWordsPerMonth: 100,
    maxCollections: 2,
    maxLessons: 3,
    llmRequestsPerMonth: 5,
    ttsCharsPerMonth: 50,
    wordGlossesPerMonth: 4,
    phraseTranslationsPerDay: null,
    contextTranslationsPerDay: null,
  },
  plus: {
    ...NO_STORAGE_LIMITS,
    phraseSelectionWords: null,
    journalWordsPerMonth: null,
    maxCollections: null,
    maxLessons: null,
    llmRequestsPerMonth: 10,
    ttsCharsPerMonth: 100,
    wordGlossesPerMonth: 8,
    phraseTranslationsPerDay: null,
    contextTranslationsPerDay: null,
  },
};

function makeDeps(overrides: Partial<EntitlementsDeps> = {}): EntitlementsDeps {
  return {
    enforced: true,
    freeTierEnabled: true,
    exemptEmails: new Set<string>(),
    prices: [
      { id: CLOUD_PRICE, plan: 'cloud' },
      { id: PLUS_PRICE, plan: 'plus' },
    ],
    planLimits: LIMITS,
    resolveEmail: () => null,
    isByok: () => false,
    compedPlan: () => null,
    now: () => new Date('2026-07-15T12:00:00Z'),
    ...overrides,
  };
}

function seedSubscription(
  userId: string,
  status: string,
  priceId: string | null,
  occurredAt = '2026-07-01T00:00:00Z',
  subId = `sub_${userId}_${status}`,
) {
  db.prepare(
    `INSERT OR REPLACE INTO billing_subscriptions
       (paddleSubscriptionId, paddleCustomerId, userId, status, priceId, currentPeriodEnd, occurredAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(subId, `ctm_${userId}`, userId, status, priceId, occurredAt, occurredAt);
}

beforeEach(() => {
  db.prepare("DELETE FROM billing_subscriptions WHERE paddleSubscriptionId LIKE 'sub_ent-%'").run();
  db.prepare("DELETE FROM billing_customers WHERE paddleCustomerId LIKE 'ctm_ent-%'").run();
  db.prepare("DELETE FROM usage_counters WHERE userId LIKE 'ent-%'").run();
  db.prepare("DELETE FROM collections WHERE userId LIKE 'ent-%'").run();
  db.prepare("DELETE FROM lessons WHERE userId LIKE 'ent-%'").run();
});

describe('parsePlanLimitOverrides', () => {
  test('returns defaults when unset or invalid', () => {
    expect(parsePlanLimitOverrides(undefined, LIMITS)).toEqual(LIMITS);
    expect(parsePlanLimitOverrides('not json', LIMITS)).toEqual(LIMITS);
    expect(parsePlanLimitOverrides('[1,2]', LIMITS)).toEqual(LIMITS);
  });

  test('merges valid numeric and null overrides per plan', () => {
    const merged = parsePlanLimitOverrides(
      '{"free":{"wordGlossesPerMonth":1200},"cloud":{"journalWordsPerMonth":8000,"phraseSelectionWords":null}}',
      LIMITS,
    );
    expect(merged.free.wordGlossesPerMonth).toBe(1200);
    expect(merged.cloud.journalWordsPerMonth).toBe(8000);
    expect(merged.cloud.phraseSelectionWords).toBeNull();
    expect(merged.cloud.maxCollections).toBe(LIMITS.cloud.maxCollections);
    expect(merged.plus).toEqual(LIMITS.plus);
  });

  test('ignores unknown plans, unknown keys, and bad values', () => {
    const merged = parsePlanLimitOverrides(
      '{"gold":{"journalWordsPerMonth":1},"cloud":{"nope":5,"journalWordsPerMonth":-3,"maxLessons":"many"}}',
      LIMITS,
    );
    expect(merged).toEqual(LIMITS);
  });

  test('Free managed rich AI and TTS are fixed at zero', () => {
    const merged = parsePlanLimitOverrides(
      '{"free":{"ttsCharsPerMonth":1000,"llmRequestsPerMonth":1000}}',
      LIMITS,
    );
    expect(merged.free.ttsCharsPerMonth).toBe(0);
    expect(merged.free.llmRequestsPerMonth).toBe(0);
  });

  test('Free overrides cannot turn any bounded allowance into null', () => {
    const merged = parsePlanLimitOverrides(
      '{"free":{"maxVocabEntries":null,"wordGlossesPerMonth":null}}',
      LIMITS,
    );
    expect(merged.free.maxVocabEntries).toBe(LIMITS.free.maxVocabEntries);
    expect(merged.free.wordGlossesPerMonth).toBe(LIMITS.free.wordGlossesPerMonth);
  });

  test('Free fair-use ceilings can be lowered but not raised beyond the takeout proof', () => {
    const defaults = parsePlanLimitOverrides(undefined);
    const merged = parsePlanLimitOverrides(
      `{"free":{"maxClozeSentences":${defaults.free.maxClozeSentences! + 1},"maxVocabEntries":5000}}`,
    );
    expect(merged.free.maxClozeSentences).toBe(defaults.free.maxClozeSentences);
    expect(merged.free.maxVocabEntries).toBe(5_000);

    const injected = makeEntitlements(
      makeDeps({
        planLimits: {
          ...defaults,
          free: { ...defaults.free, maxClozeSentences: 1_000_000 },
        },
      }),
    );
    expect(injected.resolveEntitlements('ent-free-portable').limits.maxClozeSentences).toBe(
      defaults.free.maxClozeSentences,
    );
  });

  test('default Free raw text caps feed the serialized 90 MiB portability proof', () => {
    const free = parsePlanLimitOverrides(undefined).free;
    const exportedTextBudget =
      free.maxLessonTextBytesTotal! +
      free.maxVocabTextBytesTotal! +
      free.maxKnownWordsTextBytesTotal! +
      free.maxClozeTextBytesTotal! +
      free.maxAcceptedDictionaryBytesTotal! +
      free.maxJournalTextBytesTotal!;
    expect(exportedTextBudget).toBe(17.5 * 1024 * 1024);
    expect(exportedTextBudget).toBeLessThan(20 * 1024 * 1024);
    expect(free.maxClozeSentences).toBe(25_000);
    expect(free.maxAcceptedDictionaryEntries).toBe(1_000);
  });
});

describe('usage periods', () => {
  test('derive UTC calendar month and day keys', () => {
    expect(currentPeriod(new Date('2026-07-31T23:59:59Z'))).toBe('2026-07');
    expect(currentPeriod(new Date('2026-08-01T00:00:01Z'))).toBe('2026-08');
    expect(currentDay(new Date('2026-07-31T23:59:59Z'))).toBe('2026-07-31');
    expect(currentDay(new Date('2026-08-01T00:00:01Z'))).toBe('2026-08-01');
  });
});

describe('plan resolution', () => {
  test('billing off resolves everyone to unlimited', () => {
    const engine = makeEntitlements(makeDeps({ enforced: false }));
    const resolved = engine.resolveEntitlements('ent-anyone');
    expect(resolved.plan).toBe('unlimited');
    expect(engine.checkLimit('ent-anyone', 'journalWordsPerMonth', 1_000_000).allowed).toBe(true);
    expect(engine.checkLimit('ent-anyone', 'phraseSelectionWords', 500).allowed).toBe(true);
  });

  test('exempt emails resolve to unlimited', () => {
    const engine = makeEntitlements(
      makeDeps({
        exemptEmails: new Set(['ops@example.com']),
        resolveEmail: () => 'Ops@Example.com',
      }),
    );
    expect(engine.resolveEntitlements('ent-ops').plan).toBe('unlimited');
  });

  test('maps the subscription price to the plan', () => {
    seedSubscription('ent-a', 'active', CLOUD_PRICE);
    seedSubscription('ent-b', 'active', PLUS_PRICE);
    const engine = makeEntitlements(makeDeps());
    expect(engine.resolveEntitlements('ent-a').plan).toBe('cloud');
    expect(engine.resolveEntitlements('ent-b').plan).toBe('plus');
  });

  test('the most entitled subscription wins (canceled + active coexist)', () => {
    seedSubscription('ent-c', 'canceled', PLUS_PRICE, '2026-06-01T00:00:00Z', 'sub_ent-c_old');
    seedSubscription('ent-c', 'active', CLOUD_PRICE, '2026-07-01T00:00:00Z', 'sub_ent-c_new');
    const engine = makeEntitlements(makeDeps());
    expect(engine.resolveEntitlements('ent-c').plan).toBe('cloud');
  });

  test('two entitled subs resolve to the most generous TIER, not the newest row (#222 review)', () => {
    // Both active → both entitled. Plus is the more generous tier and must win
    // even though the Cloud row is newer. Asserted in BOTH insertion orders so
    // the result can't hinge on which row the query happens to return first
    // (the old status+recency ranking let a newer Cloud shadow an older Plus).
    seedSubscription('ent-mix1', 'active', PLUS_PRICE, '2026-06-01T00:00:00Z', 'sub_ent-mix1_plus');
    seedSubscription(
      'ent-mix1',
      'active',
      CLOUD_PRICE,
      '2026-07-01T00:00:00Z',
      'sub_ent-mix1_cloud',
    );
    seedSubscription(
      'ent-mix2',
      'active',
      CLOUD_PRICE,
      '2026-07-01T00:00:00Z',
      'sub_ent-mix2_cloud',
    );
    seedSubscription('ent-mix2', 'active', PLUS_PRICE, '2026-06-01T00:00:00Z', 'sub_ent-mix2_plus');
    const engine = makeEntitlements(makeDeps());
    expect(engine.resolveEntitlements('ent-mix1').plan).toBe('plus');
    expect(engine.resolveEntitlements('ent-mix2').plan).toBe('plus');
  });

  test('unknown or missing priceId defaults a paying account to the base plan', () => {
    seedSubscription('ent-d', 'active', 'pri_removed_from_env');
    seedSubscription('ent-e', 'active', null);
    const engine = makeEntitlements(makeDeps());
    expect(engine.resolveEntitlements('ent-d').plan).toBe('cloud');
    expect(engine.resolveEntitlements('ent-e').plan).toBe('cloud');
  });

  test('no subscription derives Free only when the rollout flag is enabled', () => {
    const engine = makeEntitlements(makeDeps());
    expect(engine.resolveEntitlements('ent-none').plan).toBe('free');

    const flagOff = makeEntitlements(makeDeps({ freeTierEnabled: false }));
    expect(flagOff.resolveEntitlements('ent-none').plan).toBe('cloud');
  });

  test('injected Free tables are clamped to finite defaults and managed zeroes', () => {
    const engine = makeEntitlements(
      makeDeps({
        planLimits: {
          ...LIMITS,
          free: {
            ...LIMITS.free,
            ...NO_STORAGE_LIMITS,
            llmRequestsPerMonth: 999,
            ttsCharsPerMonth: 999,
          },
        },
      }),
    );
    const limits = engine.resolveEntitlements('ent-bounded-free').limits;
    expect(limits.llmRequestsPerMonth).toBe(0);
    expect(limits.ttsCharsPerMonth).toBe(0);
    expect(Object.values(limits).every((limit) => limit !== null)).toBe(true);
  });

  test('lapsed states derive Free while past_due retains paid grace', () => {
    seedSubscription('ent-canceled', 'canceled', PLUS_PRICE);
    seedSubscription('ent-paused', 'paused', PLUS_PRICE);
    seedSubscription('ent-expired', 'expired', PLUS_PRICE);
    seedSubscription('ent-past-due', 'past_due', CLOUD_PRICE);
    const engine = makeEntitlements(makeDeps());
    expect(engine.resolveEntitlements('ent-canceled').plan).toBe('free');
    expect(engine.resolveEntitlements('ent-paused').plan).toBe('free');
    expect(engine.resolveEntitlements('ent-expired').plan).toBe('free');
    expect(engine.resolveEntitlements('ent-past-due').plan).toBe('cloud');
  });

  test('paid BYOK lifts existing product/AI caps but never managed TTS', () => {
    seedSubscription('ent-f', 'active', CLOUD_PRICE);
    const engine = makeEntitlements(makeDeps({ isByok: () => true }));
    const resolved = engine.resolveEntitlements('ent-f');
    expect(resolved.byok).toBe(true);
    expect(resolved.limits.phraseSelectionWords).toBeNull();
    expect(resolved.limits.journalWordsPerMonth).toBeNull();
    expect(resolved.limits.llmRequestsPerMonth).toBe(50_000);
    expect(resolved.limits.wordGlossesPerMonth).toBe(100_000);
    expect(resolved.limits.ttsCharsPerMonth).toBe(LIMITS.cloud.ttsCharsPerMonth);
  });

  test('Free BYOK is an AI escape hatch without lifting product/storage or managed TTS', () => {
    const engine = makeEntitlements(
      makeDeps({
        isByok: () => true,
        planLimits: {
          ...LIMITS,
          free: { ...LIMITS.free, ttsCharsPerMonth: 999 },
        },
      }),
    );
    const resolved = engine.resolveEntitlements('ent-free-byok');
    expect(resolved).toMatchObject({ plan: 'free', byok: true });
    expect(resolved.limits.phraseSelectionWords).toBeNull();
    expect(resolved.limits.llmRequestsPerMonth).toBe(50_000);
    expect(resolved.limits.wordGlossesPerMonth).toBe(100_000);
    expect(resolved.limits.phraseTranslationsPerDay).toBeNull();
    expect(resolved.limits.contextTranslationsPerDay).toBeNull();
    expect(resolved.limits.journalWordsPerMonth).toBe(LIMITS.free.journalWordsPerMonth);
    expect(resolved.limits.maxCollections).toBe(LIMITS.free.maxCollections);
    expect(resolved.limits.maxLessons).toBe(LIMITS.free.maxLessons);
    expect(resolved.limits.ttsCharsPerMonth).toBe(0);
    const verdict = engine.reserve('ent-free-byok', 'llmRequestsPerMonth');
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) expect(verdict.reservation.byok).toBe(true);
  });

  test('a comped account resolves to its comped tier, ahead of any subscription (#221)', () => {
    // No subscription at all, comped to Plus → Plus limits (not the base plan).
    const plusEngine = makeEntitlements(
      makeDeps({ compedPlan: (id) => (id === 'ent-comp' ? 'plus' : null) }),
    );
    expect(plusEngine.resolveEntitlements('ent-comp').plan).toBe('plus');
    expect(plusEngine.resolveEntitlements('ent-comp').limits.phraseSelectionWords).toBe(
      LIMITS.plus.phraseSelectionWords,
    );

    // Comp overrides a real subscription too (deliberate operator grant).
    seedSubscription('ent-comp2', 'active', CLOUD_PRICE);
    const bumpEngine = makeEntitlements(
      makeDeps({ compedPlan: (id) => (id === 'ent-comp2' ? 'plus' : null) }),
    );
    expect(bumpEngine.resolveEntitlements('ent-comp2').plan).toBe('plus');

    // byok still lifts caps on top of a comped tier.
    const byokComp = makeEntitlements(makeDeps({ compedPlan: () => 'cloud', isByok: () => true }));
    expect(byokComp.resolveEntitlements('ent-comp3').limits.journalWordsPerMonth).toBeNull();
  });
});

describe('checkLimit boundaries', () => {
  test('Free managed TTS is zero and recommends Cloud while browser speech stays client-side', () => {
    const engine = makeEntitlements(
      makeDeps({
        planLimits: {
          ...LIMITS,
          free: { ...LIMITS.free, ttsCharsPerMonth: 999 },
        },
      }),
    );
    expect(engine.resolveEntitlements('ent-free-tts').limits.ttsCharsPerMonth).toBe(0);
    const verdict = engine.checkLimit('ent-free-tts', 'ttsCharsPerMonth', 1);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.plan).toBe('free');
      expect(verdict.limit).toBe(0);
      expect(verdict.upgrade).toBe('cloud');
    }
  });

  test('phrase selection: at the cap allowed, one over blocked with the upsell payload', () => {
    seedSubscription('ent-g', 'active', CLOUD_PRICE);
    const engine = makeEntitlements(makeDeps());
    expect(engine.checkLimit('ent-g', 'phraseSelectionWords', 9).allowed).toBe(true);
    const verdict = engine.checkLimit('ent-g', 'phraseSelectionWords', 10);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.metric).toBe('phraseSelectionWords');
      expect(verdict.limit).toBe(9);
      expect(verdict.requested).toBe(10);
      expect(verdict.plan).toBe('cloud');
      expect(verdict.upgrade).toBe('plus');
    }
  });

  test('plus lifts the phrase cap entirely', () => {
    seedSubscription('ent-h', 'active', PLUS_PRICE);
    const engine = makeEntitlements(makeDeps());
    expect(engine.checkLimit('ent-h', 'phraseSelectionWords', 500).allowed).toBe(true);
  });

  test('metered limits: used + requested must fit; recording accumulates', () => {
    seedSubscription('ent-i', 'active', CLOUD_PRICE);
    const engine = makeEntitlements(makeDeps());
    engine.recordUsage('ent-i', 'journalWordsPerMonth', 90);
    expect(engine.getUsage('ent-i', 'journalWordsPerMonth')).toBe(90);
    expect(engine.checkLimit('ent-i', 'journalWordsPerMonth', 10).allowed).toBe(true);
    const verdict = engine.checkLimit('ent-i', 'journalWordsPerMonth', 11);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.used).toBe(90);
      expect(verdict.limit).toBe(100);
    }
  });

  test('counters reset when the month rolls over', () => {
    seedSubscription('ent-j', 'active', CLOUD_PRICE);
    let nowValue = new Date('2026-07-15T23:00:00Z');
    const engine = makeEntitlements(makeDeps({ now: () => nowValue }));
    engine.recordUsage('ent-j', 'llmRequestsPerMonth', 5);
    expect(engine.checkLimit('ent-j', 'llmRequestsPerMonth', 1).allowed).toBe(false);

    nowValue = new Date('2026-08-01T01:00:00Z');
    expect(engine.getUsage('ent-j', 'llmRequestsPerMonth')).toBe(0);
    expect(engine.checkLimit('ent-j', 'llmRequestsPerMonth', 1).allowed).toBe(true);
  });

  test('daily translation counters reset independently of monthly counters', () => {
    let nowValue = new Date('2026-07-31T23:00:00Z');
    const engine = makeEntitlements(makeDeps({ now: () => nowValue }));
    engine.recordUsage('ent-daily', 'phraseTranslationsPerDay', 2);
    engine.recordUsage('ent-daily', 'wordGlossesPerMonth', 3);
    const firstPeriods = engine.currentPeriods();
    expect(engine.checkLimit('ent-daily', 'phraseTranslationsPerDay').allowed).toBe(false);
    expect(engine.checkLimit('ent-daily', 'wordGlossesPerMonth').allowed).toBe(false);

    nowValue = new Date('2026-07-16T00:00:00Z');
    expect(engine.getUsage('ent-daily', 'phraseTranslationsPerDay')).toBe(0);
    expect(engine.getUsage('ent-daily', 'phraseTranslationsPerDay', firstPeriods)).toBe(2);
    expect(engine.getUsage('ent-daily', 'wordGlossesPerMonth')).toBe(3);
    expect(engine.checkLimit('ent-daily', 'wordGlossesPerMonth').allowed).toBe(false);

    nowValue = new Date('2026-08-01T00:00:00Z');
    expect(engine.getUsage('ent-daily', 'wordGlossesPerMonth')).toBe(0);
    expect(engine.currentPeriods()).toEqual({ day: '2026-08-01', month: '2026-08' });
  });

  test('library limits count the live tables', () => {
    seedSubscription('ent-k', 'active', CLOUD_PRICE);
    const engine = makeEntitlements(makeDeps());
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId)
       VALUES (?, 'T', 'A', 'af', ?, ?, ?)`,
    );
    insert.run('ent-k-c1', now, now, 'ent-k');
    expect(engine.checkLimit('ent-k', 'maxCollections').allowed).toBe(true);
    insert.run('ent-k-c2', now, now, 'ent-k');
    const verdict = engine.checkLimit('ent-k', 'maxCollections');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.used).toBe(2);
  });

  test('plus over its metered ceiling upsells to byok', () => {
    seedSubscription('ent-l', 'active', PLUS_PRICE);
    const engine = makeEntitlements(makeDeps());
    engine.recordUsage('ent-l', 'llmRequestsPerMonth', 10);
    const verdict = engine.checkLimit('ent-l', 'llmRequestsPerMonth', 1);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.upgrade).toBe('byok');
  });

  test('Plus never recommends BYOK for managed TTS or non-AI product limits', () => {
    seedSubscription('ent-plus-non-ai', 'active', PLUS_PRICE);
    const planLimits = {
      ...LIMITS,
      plus: { ...LIMITS.plus, journalWordsPerMonth: 5 },
    };
    const engine = makeEntitlements(makeDeps({ planLimits }));
    engine.recordUsage('ent-plus-non-ai', 'ttsCharsPerMonth', 100);
    engine.recordUsage('ent-plus-non-ai', 'journalWordsPerMonth', 5);
    for (const metric of ['ttsCharsPerMonth', 'journalWordsPerMonth'] as const) {
      const verdict = engine.checkLimit('ent-plus-non-ai', metric);
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.upgrade).toBeNull();
    }
  });

  test('recordUsage ignores non-positive amounts', () => {
    const engine = makeEntitlements(makeDeps());
    engine.recordUsage('ent-m', 'journalWordsPerMonth', 0);
    engine.recordUsage('ent-m', 'journalWordsPerMonth', -5);
    expect(engine.getUsage('ent-m', 'journalWordsPerMonth')).toBe(0);
  });
});

describe('reserve / refund / reserveCount (atomic metering, #222 review)', () => {
  test('reserve records atomically and denies once the counter is full', () => {
    seedSubscription('ent-r1', 'active', CLOUD_PRICE); // llm cap 5
    const engine = makeEntitlements(makeDeps());
    for (let i = 0; i < 5; i++) {
      expect(engine.reserve('ent-r1', 'llmRequestsPerMonth').allowed).toBe(true);
    }
    // The sixth is denied and must NOT record — reserving is check+increment in
    // one synchronous step, so the boundary can't be crossed by a check whose
    // increment hasn't landed yet (the old check-then-record race).
    expect(engine.reserve('ent-r1', 'llmRequestsPerMonth').allowed).toBe(false);
    expect(engine.getUsage('ent-r1', 'llmRequestsPerMonth')).toBe(5);
  });

  test('reserve takes SQLite write ownership before reading the counter', () => {
    seedSubscription('ent-r-lock', 'active', CLOUD_PRICE);
    const competingDb = new Database(path.join(process.env.DATA_DIR!, 'lector.db'));
    competingDb.exec('PRAGMA busy_timeout = 0');
    let competingWriteError: unknown;
    const engine = makeEntitlements(
      makeDeps({
        resolveEmail: () => {
          try {
            competingDb
              .prepare(
                `INSERT INTO usage_counters (userId, metric, period, value, updatedAt)
                 VALUES ('ent-r-lock-competitor', 'llmRequestsPerMonth', '2026-07', 1, ?)`,
              )
              .run(new Date().toISOString());
          } catch (error) {
            competingWriteError = error;
          }
          return null;
        },
      }),
    );

    try {
      expect(engine.reserve('ent-r-lock', 'llmRequestsPerMonth').allowed).toBe(true);
      expect(String(competingWriteError)).toContain('database is locked');
    } finally {
      competingDb.close();
      db.prepare("DELETE FROM usage_counters WHERE userId = 'ent-r-lock-competitor'").run();
    }
  });

  test('daily reservations stop exactly at the Free boundary', () => {
    const engine = makeEntitlements(makeDeps()); // phrase/day cap 2
    expect(engine.reserve('ent-r-daily', 'phraseTranslationsPerDay').allowed).toBe(true);
    expect(engine.reserve('ent-r-daily', 'phraseTranslationsPerDay').allowed).toBe(true);
    expect(engine.reserve('ent-r-daily', 'phraseTranslationsPerDay').allowed).toBe(false);
    expect(engine.getUsage('ent-r-daily', 'phraseTranslationsPerDay')).toBe(2);
  });

  test('refund returns allowance and never drives a counter negative', () => {
    seedSubscription('ent-r2', 'active', CLOUD_PRICE); // tts cap 50
    const engine = makeEntitlements(makeDeps());
    const verdict = engine.reserve('ent-r2', 'ttsCharsPerMonth', 40);
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) throw new Error('reservation unexpectedly denied');
    engine.refund(verdict.reservation);
    expect(engine.getUsage('ent-r2', 'ttsCharsPerMonth')).toBe(0);
    // A repeated refund clamps at zero rather than going negative.
    engine.refund(verdict.reservation);
    expect(engine.getUsage('ent-r2', 'ttsCharsPerMonth')).toBe(0);
    // A full month's allowance is available again after the refund.
    expect(engine.reserve('ent-r2', 'ttsCharsPerMonth', 50).allowed).toBe(true);
  });

  test('refund uses the reserved period when a provider call crosses UTC midnight', () => {
    let nowValue = new Date('2026-07-15T23:59:59Z');
    const engine = makeEntitlements(makeDeps({ now: () => nowValue }));
    const verdict = engine.reserve('ent-midnight', 'phraseTranslationsPerDay');
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) throw new Error('reservation unexpectedly denied');
    expect(verdict.reservation.period).toBe('2026-07-15');

    nowValue = new Date('2026-07-16T00:00:01Z');
    engine.refund(verdict.reservation);
    const old = db
      .prepare('SELECT value FROM usage_counters WHERE userId = ? AND metric = ? AND period = ?')
      .get('ent-midnight', 'phraseTranslationsPerDay', '2026-07-15') as
      | { value: number }
      | undefined;
    expect(old?.value).toBe(0);
    expect(engine.getUsage('ent-midnight', 'phraseTranslationsPerDay')).toBe(0);
  });

  test('reserveCount inserts only when under the cap, atomically with the check', () => {
    seedSubscription('ent-r3', 'active', CLOUD_PRICE); // maxCollections cap 2
    const engine = makeEntitlements(makeDeps());
    const now = new Date().toISOString();
    let n = 0;
    const insert = () => {
      n += 1;
      db.prepare(
        `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId)
         VALUES (?, 'T', 'A', 'af', ?, ?, 'ent-r3')`,
      ).run(`ent-r3-c${n}`, now, now);
    };

    expect(engine.reserveCount('ent-r3', [{ metric: 'maxCollections' }], insert).allowed).toBe(
      true,
    );
    expect(engine.reserveCount('ent-r3', [{ metric: 'maxCollections' }], insert).allowed).toBe(
      true,
    );
    // The third is over the cap: verdict denied AND the insert never ran.
    expect(engine.reserveCount('ent-r3', [{ metric: 'maxCollections' }], insert).allowed).toBe(
      false,
    );
    const count = db
      .prepare("SELECT COUNT(*) n FROM collections WHERE userId = 'ent-r3'")
      .get() as { n: number };
    expect(count.n).toBe(2);
  });

  test('reserveCount rolls the whole batch back if a later insert throws', () => {
    seedSubscription('ent-r4', 'active', CLOUD_PRICE);
    const engine = makeEntitlements(makeDeps());
    const now = new Date().toISOString();
    expect(() =>
      engine.reserveCount('ent-r4', [{ metric: 'maxCollections' }], () => {
        db.prepare(
          `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId)
           VALUES ('ent-r4-c1', 'T', 'A', 'af', ?, ?, 'ent-r4')`,
        ).run(now, now);
        throw new Error('boom after first insert');
      }),
    ).toThrow('boom');
    // The insert that ran before the throw is rolled back with the transaction.
    const count = db
      .prepare("SELECT COUNT(*) n FROM collections WHERE userId = 'ent-r4'")
      .get() as { n: number };
    expect(count.n).toBe(0);
  });
});
