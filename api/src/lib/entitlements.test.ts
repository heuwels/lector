import '../test-guard';
import { describe, test, expect, beforeEach } from 'bun:test';
import { db } from '../db';
import {
  currentPeriod,
  makeEntitlements,
  parsePlanLimitOverrides,
  type EntitlementsDeps,
  type PlanLimits,
} from './entitlements';

// Engine unit tests (#222) — boundaries per the issue's "Done when".
// Uses the real test DB (usage_counters + billing mirror tables) with
// namespaced user ids so it can't collide with the billing suite.

const CLOUD_PRICE = 'pri_ent_cloud';
const PLUS_PRICE = 'pri_ent_plus';

const LIMITS: Record<'cloud' | 'plus', PlanLimits> = {
  cloud: {
    phraseSelectionWords: 9,
    journalWordsPerMonth: 100,
    maxCollections: 2,
    maxLessons: 3,
    llmRequestsPerMonth: 5,
    ttsCharsPerMonth: 50,
  },
  plus: {
    phraseSelectionWords: null,
    journalWordsPerMonth: null,
    maxCollections: null,
    maxLessons: null,
    llmRequestsPerMonth: 10,
    ttsCharsPerMonth: 100,
  },
};

function makeDeps(overrides: Partial<EntitlementsDeps> = {}): EntitlementsDeps {
  return {
    enforced: true,
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
      '{"cloud":{"journalWordsPerMonth":8000,"phraseSelectionWords":null}}',
      LIMITS,
    );
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
});

describe('currentPeriod', () => {
  test('is the UTC calendar month', () => {
    expect(currentPeriod(new Date('2026-07-31T23:59:59Z'))).toBe('2026-07');
    expect(currentPeriod(new Date('2026-08-01T00:00:01Z'))).toBe('2026-08');
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

  test('unknown or missing priceId defaults a paying account to the base plan', () => {
    seedSubscription('ent-d', 'active', 'pri_removed_from_env');
    seedSubscription('ent-e', 'active', null);
    const engine = makeEntitlements(makeDeps());
    expect(engine.resolveEntitlements('ent-d').plan).toBe('cloud');
    expect(engine.resolveEntitlements('ent-e').plan).toBe('cloud');
  });

  test('no subscription at all falls back to base-plan limits (gate 402s first in prod)', () => {
    const engine = makeEntitlements(makeDeps());
    expect(engine.resolveEntitlements('ent-none').plan).toBe('cloud');
  });

  test('byok lifts product caps but keeps metered abuse ceilings', () => {
    seedSubscription('ent-f', 'active', CLOUD_PRICE);
    const engine = makeEntitlements(makeDeps({ isByok: () => true }));
    const resolved = engine.resolveEntitlements('ent-f');
    expect(resolved.byok).toBe(true);
    expect(resolved.limits.phraseSelectionWords).toBeNull();
    expect(resolved.limits.journalWordsPerMonth).toBeNull();
    expect(resolved.limits.llmRequestsPerMonth).not.toBeNull();
  });

  test('a comped account resolves to its comped tier, ahead of any subscription (#221)', () => {
    // No subscription at all, comped to Plus → Plus limits (not the base plan).
    const plusEngine = makeEntitlements(makeDeps({ compedPlan: (id) => (id === 'ent-comp' ? 'plus' : null) }));
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
    const byokComp = makeEntitlements(
      makeDeps({ compedPlan: () => 'cloud', isByok: () => true }),
    );
    expect(byokComp.resolveEntitlements('ent-comp3').limits.journalWordsPerMonth).toBeNull();
  });
});

describe('checkLimit boundaries', () => {
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
    let nowValue = new Date('2026-07-31T23:00:00Z');
    const engine = makeEntitlements(makeDeps({ now: () => nowValue }));
    engine.recordUsage('ent-j', 'llmRequestsPerMonth', 5);
    expect(engine.checkLimit('ent-j', 'llmRequestsPerMonth', 1).allowed).toBe(false);

    nowValue = new Date('2026-08-01T01:00:00Z');
    expect(engine.getUsage('ent-j', 'llmRequestsPerMonth')).toBe(0);
    expect(engine.checkLimit('ent-j', 'llmRequestsPerMonth', 1).allowed).toBe(true);
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

  test('recordUsage ignores non-positive amounts', () => {
    const engine = makeEntitlements(makeDeps());
    engine.recordUsage('ent-m', 'journalWordsPerMonth', 0);
    engine.recordUsage('ent-m', 'journalWordsPerMonth', -5);
    expect(engine.getUsage('ent-m', 'journalWordsPerMonth')).toBe(0);
  });
});
