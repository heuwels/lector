import '../test-guard';
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { db } from '../db';
import {
  makeEntitlements,
  NO_STORAGE_LIMITS,
  setEntitlementsEngineForTests,
  type PlanLimits,
} from '../lib/entitlements';

// Make the LLM correction deterministic so the /:id/correct flow is testable.
mock.module('../lib/journal-correct', () => ({
  correctJournalText: async () => ({
    correctedBody: 'Reggestelde teks.',
    corrections: [{ original: 'fout', corrected: 'reg', explanation: 'x', type: 'spelling' }],
  }),
}));

const { default: app } = await import('../routes/journal');

function setLang(code: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'targetLanguage',
    JSON.stringify(code),
  );
}

function reset() {
  db.prepare('DELETE FROM journal_entries').run();
  db.prepare("DELETE FROM usage_counters WHERE userId = 'local'").run();
  db.prepare("DELETE FROM settings WHERE key = 'targetLanguage'").run();
}

function insertEntry(
  id: string,
  body: string,
  entryDate: string,
  status = 'draft',
  createdAt?: string,
) {
  const now = createdAt || new Date().toISOString();
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  db.prepare(
    `INSERT INTO journal_entries (id, body, status, wordCount, entryDate, language, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 'af', ?, ?)`,
  ).run(id, body, status, wordCount, entryDate, now, now);
}

describe('journal route', () => {
  beforeEach(() => {
    reset();
    setLang('af');
  });
  afterEach(reset);

  test('GET / returns entries newest-first', async () => {
    insertEntry('a', 'Dag een', '2026-01-01', 'draft', '2026-01-01T10:00:00Z');
    insertEntry('b', 'Dag twee', '2026-01-02', 'draft', '2026-01-02T10:00:00Z');
    const res = await app.request('/?language=af');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { id: string }[];
    expect(data.map((e) => e.id)).toEqual(['b', 'a']);
  });

  test('GET /?date= filters by date, newest-first', async () => {
    insertEntry('a', 'Morning', '2026-03-15', 'draft', '2026-03-15T08:00:00Z');
    insertEntry('b', 'Evening', '2026-03-15', 'draft', '2026-03-15T20:00:00Z');
    insertEntry('c', 'Other day', '2026-03-16', 'draft', '2026-03-16T10:00:00Z');
    const res = await app.request('/?language=af&date=2026-03-15');
    const data = (await res.json()) as { id: string }[];
    expect(data.map((e) => e.id)).toEqual(['b', 'a']);
  });

  test('POST / creates a draft with a computed wordCount', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Vandag was lekker.', entryDate: '2026-04-10', language: 'af' }),
    });
    expect(res.status).toBe(200);
    const { id, entryDate } = (await res.json()) as { id: string; entryDate: string };
    expect(entryDate).toBe('2026-04-10');
    const row = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    expect(row.status).toBe('draft');
    expect(row.wordCount).toBe(3);
  });

  test('GET /:id returns 404 for a missing entry', async () => {
    expect((await app.request('/nope')).status).toBe(404);
  });

  test('PUT /:id updates a draft but rejects a submitted entry', async () => {
    insertEntry('d', 'Ou teks', '2026-06-01', 'draft');
    const ok = await app.request('/d', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Opgedateer' }),
    });
    expect(ok.status).toBe(200);
    const updated = db.prepare('SELECT wordCount FROM journal_entries WHERE id = ?').get('d') as {
      wordCount: number;
    };
    expect(updated.wordCount).toBe(1);

    insertEntry('s', 'Submitted', '2026-06-01', 'submitted');
    const rejected = await app.request('/s', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'verander' }),
    });
    expect(rejected.status).toBe(400);
  });

  test('DELETE /:id removes the entry (404 when missing)', async () => {
    insertEntry('x', 'Te verwyder', '2026-07-01');
    expect((await app.request('/x', { method: 'DELETE' })).status).toBe(200);
    expect(db.prepare('SELECT id FROM journal_entries WHERE id = ?').get('x')).toBeNull();
    expect((await app.request('/nope', { method: 'DELETE' })).status).toBe(404);
  });

  test('POST /:id/correct saves the correction and marks the entry submitted', async () => {
    insertEntry('c1', 'Ek het fout gemaak.', '2026-08-01', 'draft');
    const res = await app.request('/c1/correct', { method: 'POST' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get('c1') as Record<
      string,
      unknown
    >;
    expect(row.status).toBe('submitted');
    expect(row.correctedBody).toBe('Reggestelde teks.');
    expect(JSON.parse(row.corrections as string)).toHaveLength(1);
  });

  test('POST /:id/correct refunds LLM usage when correction storage is over cap', async () => {
    const limits: PlanLimits = {
      ...NO_STORAGE_LIMITS,
      phraseSelectionWords: 9,
      journalWordsPerMonth: 5_000,
      maxCollections: 50,
      maxLessons: 1_000,
      maxJournalEntryBytes: 1,
      llmRequestsPerMonth: 1,
      ttsCharsPerMonth: 1,
      wordGlossesPerMonth: 1,
      phraseTranslationsPerDay: null,
      contextTranslationsPerDay: null,
      audioTranscriptionMinutesPerMonth: null,
    };
    const engine = makeEntitlements({
      enforced: true,
      freeTierEnabled: true,
      exemptEmails: new Set(),
      prices: [],
      planLimits: { free: limits, cloud: limits, plus: limits },
      resolveEmail: () => null,
      isByok: () => false,
      compedPlan: () => 'cloud',
      now: () => new Date('2026-08-01T12:00:00Z'),
    });
    const restoreEngine = setEntitlementsEngineForTests(engine);
    insertEntry('over-cap', 'Ek het fout gemaak.', '2026-08-01', 'draft');

    try {
      const response = await app.request('/over-cap/correct', { method: 'POST' });
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({
        error: 'plan_limit',
        metric: 'maxJournalEntryBytes',
      });
      expect(engine.getUsage('local', 'llmRequestsPerMonth')).toBe(0);
      expect(
        db.prepare("SELECT status, correctedBody FROM journal_entries WHERE id = 'over-cap'").get(),
      ).toEqual({ status: 'draft', correctedBody: null });
    } finally {
      restoreEngine();
    }
  });

  test('POST /:id/correct 404s for a missing entry', async () => {
    expect((await app.request('/nope/correct', { method: 'POST' })).status).toBe(404);
  });
});
