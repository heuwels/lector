import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';
import {
  makeEntitlements,
  setEntitlementsEngineForTests,
  type EntitlementsDeps,
  type PlanLimits,
} from '../lib/entitlements';
import journal from './journal';
import collections from './collections';
import translate from './translate';

// Route-enforcement tests (#222): a strict engine is installed behind the
// facade the route modules imported, so the 429 paths are exercised through
// the real handlers. Over-limit paths return before any LLM provider or
// Google call, so no network mocking is needed here.

const STRICT: PlanLimits = {
  phraseSelectionWords: 3,
  journalWordsPerMonth: 10,
  maxCollections: 1,
  maxLessons: 1,
  llmRequestsPerMonth: 100,
  ttsCharsPerMonth: 100,
};

function strictEngine(overrides: Partial<EntitlementsDeps> = {}) {
  return makeEntitlements({
    enforced: true,
    exemptEmails: new Set(),
    prices: [],
    // Every plan resolves to 'cloud' (no subscription rows in selfhost test
    // mode) — point both plans at the strict limits.
    planLimits: { cloud: STRICT, plus: STRICT },
    resolveEmail: () => null,
    isByok: () => false,
    compedPlan: () => null,
    now: () => new Date('2026-07-15T12:00:00Z'),
    ...overrides,
  });
}

let restore: (() => void) | null = null;

beforeEach(() => {
  db.prepare("DELETE FROM usage_counters WHERE userId = 'local'").run();
  db.prepare("DELETE FROM journal_entries WHERE userId = 'local'").run();
  db.prepare("DELETE FROM lessons WHERE userId = 'local'").run();
  db.prepare("DELETE FROM collections WHERE userId = 'local'").run();
  restore = setEntitlementsEngineForTests(strictEngine());
});

afterEach(() => {
  restore?.();
  restore = null;
});

async function planLimitBody(res: Response) {
  expect(res.status).toBe(429);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.error).toBe('plan_limit');
  return body;
}

describe('journal words per month', () => {
  test('a save within the allowance lands and is metered', async () => {
    const res = await journal.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'een twee drie vier vyf' }),
    });
    expect(res.status).toBe(200);
    const counter = db
      .prepare(
        "SELECT value FROM usage_counters WHERE userId = 'local' AND metric = 'journalWordsPerMonth'",
      )
      .get() as { value: number } | undefined;
    expect(counter?.value).toBe(5);
  });

  test('a save that would cross the monthly cap is refused with the upsell payload', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `w${i}`).join(' ');
    const res = await journal.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: eleven }),
    });
    const body = await planLimitBody(res);
    expect(body.metric).toBe('journalWordsPerMonth');
    expect(body.limit).toBe(10);
    // Nothing was saved or metered.
    expect(db.prepare("SELECT COUNT(*) n FROM journal_entries WHERE userId='local'").get()).toEqual({ n: 0 });
  });

  test('edits meter only growth, and shrinking never refunds', async () => {
    const create = await journal.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'een twee drie' }),
    });
    const { id } = (await create.json()) as { id: string };

    // Shrink: 3 → 1 words. No new usage.
    let res = await journal.request(`/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'een' }),
    });
    expect(res.status).toBe(200);
    let counter = db
      .prepare("SELECT value FROM usage_counters WHERE userId='local' AND metric='journalWordsPerMonth'")
      .get() as { value: number };
    expect(counter.value).toBe(3);

    // Grow: 1 → 8 words = +7 usage (3 + 7 = 10, exactly at the cap).
    res = await journal.request(`/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: Array.from({ length: 8 }, (_, i) => `w${i}`).join(' ') }),
    });
    expect(res.status).toBe(200);
    counter = db
      .prepare("SELECT value FROM usage_counters WHERE userId='local' AND metric='journalWordsPerMonth'")
      .get() as { value: number };
    expect(counter.value).toBe(10);

    // Any further growth crosses the cap.
    res = await journal.request(`/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: Array.from({ length: 9 }, (_, i) => `w${i}`).join(' ') }),
    });
    await planLimitBody(res);
  });
});

describe('library size', () => {
  test('collection creation over the cap is refused', async () => {
    const first = await collections.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Eerste' }),
    });
    expect(first.status).toBe(200);

    const second = await collections.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Tweede' }),
    });
    const body = await planLimitBody(second);
    expect(body.metric).toBe('maxCollections');
  });

  test('lesson creation over the cap is refused', async () => {
    const coll = await collections.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Boek' }),
    });
    const { id } = (await coll.json()) as { id: string };

    const first = await collections.request(`/${id}/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hoofstuk 1', textContent: 'teks' }),
    });
    expect(first.status).toBe(200);

    const second = await collections.request(`/${id}/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hoofstuk 2', textContent: 'teks' }),
    });
    const body = await planLimitBody(second);
    expect(body.metric).toBe('maxLessons');
  });
});

describe('phrase selection cap', () => {
  test('an over-cap phrase translation is refused before any provider call', async () => {
    const res = await translate.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: 'een twee drie vier', type: 'phrase' }),
    });
    const body = await planLimitBody(res);
    expect(body.metric).toBe('phraseSelectionWords');
    expect(body.requested).toBe(4);
    expect(body.limit).toBe(3);
  });
});

describe('unlimited plans bypass everything', () => {
  test('billing-off engine (selfhost) never limits', async () => {
    restore?.();
    restore = setEntitlementsEngineForTests(strictEngine({ enforced: false }));

    const eleven = Array.from({ length: 11 }, (_, i) => `w${i}`).join(' ');
    const res = await journal.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: eleven }),
    });
    expect(res.status).toBe(200);
  });
});
