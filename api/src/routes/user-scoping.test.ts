import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';

const { default: vocabApp } = await import('../routes/vocab');
const { default: clozeApp } = await import('../routes/cloze');
const { default: knownWordsApp } = await import('../routes/known-words');
const { default: settingsApp } = await import('../routes/settings');

// The userId-scoping ratchet (#217, plan 010 piece 2) — the multi-tenant twin
// of language-scoping.test.ts. Rows are seeded for a different user directly
// in the DB; every route must behave as if they do not exist: lists exclude
// them, by-id reads 404, mutations no-op. When adding a user-data route, add
// its cross-user cases here.

const INTRUDER = 'intruder-user';
const TS = '2026-01-01T00:00:00Z';

// Every user-data table; shared read-only tables are deliberately absent.
const USER_TABLES = [
  'collections',
  'lessons',
  'vocab',
  'knownWords',
  'clozeSentences',
  'dailyStats',
  'chat_messages',
  'journal_entries',
  'collection_groups',
  'api_tokens',
  'settings',
];

function reset() {
  db.prepare('DELETE FROM vocab').run();
  db.prepare('DELETE FROM knownWords').run();
  db.prepare('DELETE FROM clozeSentences').run();
  db.prepare("DELETE FROM settings WHERE key LIKE 'ratchet_%'").run();
}

function seedIntruderVocab(id: string) {
  db.prepare(
    `INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, createdAt, language, userId)
     VALUES (?, 'geheim', 'word', 'n sin', 'secret', 'new', ?, ?, 'af', ?)`,
  ).run(id, TS, TS, INTRUDER);
}

function seedIntruderCloze(id: string) {
  db.prepare(
    `INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, nextReview, language, userId)
     VALUES (?, 'Die ___ is geheim.', 'woord', 1, 'The word is secret.', 'tatoeba', 'random', ?, 'af', ?)`,
  ).run(id, TS, INTRUDER);
}

describe('userId scoping ratchet', () => {
  beforeEach(reset);
  afterEach(reset);

  test('every user-data table carries the userId column (migration ratchet)', () => {
    for (const table of USER_TABLES) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      expect(cols.length, `${table} should exist`).toBeGreaterThan(0);
      expect(
        cols.some((c) => c.name === 'userId'),
        `${table} must carry userId`,
      ).toBe(true);
    }
  });

  test("vocab lists exclude another user's rows", async () => {
    seedIntruderVocab('v_intruder');
    const res = await vocabApp.request('/?language=af');
    const rows = (await res.json()) as { id: string }[];
    expect(rows.find((r) => r.id === 'v_intruder')).toBeUndefined();
  });

  test("vocab by-id routes 404 / no-op on another user's row", async () => {
    seedIntruderVocab('v_intruder');

    expect((await vocabApp.request('/v_intruder')).status).toBe(404);

    const put = await vocabApp.request('/v_intruder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ translation: 'hijacked' }),
    });
    expect(put.status).toBe(404);

    const del = await vocabApp.request('/v_intruder', { method: 'DELETE' });
    expect(del.status).toBe(404);
    const survives = db.prepare('SELECT COUNT(*) AS n FROM vocab WHERE id = ?').get('v_intruder') as { n: number };
    expect(survives.n).toBe(1);
  });

  test("known-words map excludes another user's words", async () => {
    db.prepare("INSERT INTO knownWords (userId, word, language, state) VALUES (?, 'geheim', 'af', 'known')").run(INTRUDER);
    const res = await knownWordsApp.request('/?language=af');
    const map = (await res.json()) as Record<string, string>;
    expect(map.geheim).toBeUndefined();
  });

  test("cloze routes never serve or mutate another user's cards", async () => {
    seedIntruderCloze('c_intruder');

    const list = await clozeApp.request('/?language=af');
    const rows = (await list.json()) as { id: string }[];
    expect(rows.find((r) => r.id === 'c_intruder')).toBeUndefined();

    const due = await clozeApp.request('/due?language=af');
    const dueRows = (await due.json()) as { id: string }[];
    expect(dueRows.find((r) => r.id === 'c_intruder')).toBeUndefined();

    expect((await clozeApp.request('/c_intruder?language=af')).status).toBe(404);

    const review = await clozeApp.request('/c_intruder/review?language=af', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct: true, masteryLevel: 25, nextReview: TS }),
    });
    expect(review.status).toBe(404);

    await clozeApp.request('/c_intruder?language=af', { method: 'DELETE' });
    const survives = db.prepare('SELECT COUNT(*) AS n FROM clozeSentences WHERE id = ?').get('c_intruder') as { n: number };
    expect(survives.n).toBe(1);
  });

  test("settings are per-user — reads exclude, writes land on the requester", async () => {
    db.prepare("INSERT INTO settings (userId, key, value) VALUES (?, 'ratchet_secret', '\"x\"')").run(INTRUDER);

    const list = await settingsApp.request('/');
    const settings = (await list.json()) as Record<string, unknown>;
    expect(settings.ratchet_secret).toBeUndefined();

    // Bulk PUT lands on the local user, never anyone else. Must be an
    // allowlisted key — settings writes are validated since #233.
    const put = await settingsApp.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: 'Australia/Sydney' }),
    });
    expect(put.status).toBe(200);
    const row = db
      .prepare("SELECT userId FROM settings WHERE key = 'timezone'")
      .get() as { userId: string };
    expect(row.userId).toBe('local');
    db.prepare("DELETE FROM settings WHERE key = 'timezone'").run();
  });

  test("cloze counts don't leak another user's totals", async () => {
    seedIntruderCloze('c_intruder');
    const res = await clozeApp.request('/counts?language=af');
    const counts = (await res.json()) as Record<string, { total: number }>;
    const total = Object.values(counts).reduce((s, c) => s + c.total, 0);
    expect(total).toBe(0);
  });
});
