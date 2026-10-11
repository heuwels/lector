import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';

const { default: app } = await import('../routes/practice');

// POST /api/practice/srs-queue — the SRS review picker.
//
// The queue is driven by the word's learning level, which lives in `state`
// (`level1`..`level7`), and by `next_review`: a word is due when it has never
// been reviewed (NULL) or its date has passed. Three invariants matter: it
// stays inside one language, it respects the requested level set, and it never
// returns future-scheduled or non-level words.

const TS = '2026-01-01T00:00:00Z';
const DUE = '2025-01-01T00:00:00Z';
const FUTURE = '2999-01-01T00:00:00Z';

function seedSrs(
  id: string,
  text: string,
  language: string,
  state: string,
  nextReview: string | null,
  srsLevel = 1,
) {
  db.prepare(
    `INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, createdAt, language, srs_level, next_review)
     VALUES (?, ?, 'word', 's', 't', ?, ?, ?, ?, ?, ?)`,
  ).run(id, text, state, TS, TS, language, srsLevel, nextReview);
}

describe('POST /api/practice/srs-queue', () => {
  const clear = () => {
    db.prepare('DELETE FROM knownWords').run();
    db.prepare('DELETE FROM vocab').run();
  };
  beforeEach(clear);
  afterEach(clear);

  function queue(body: unknown) {
    return app.request('/srs-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function texts(body: unknown): Promise<string[]> {
    const res = await queue(body);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { words: { text: string }[] };
    return data.words.map((w) => w.text);
  }

  test('returns never-reviewed and overdue words, scoped to the language', async () => {
    seedSrs('v_af_new', 'huis', 'af', 'level2', null);
    seedSrs('v_af_overdue', 'kat', 'af', 'level2', DUE);
    seedSrs('v_af_future', 'boom', 'af', 'level2', FUTURE);
    seedSrs('v_af_known', 'hond', 'af', 'known', null);
    seedSrs('v_de', 'haus', 'de', 'level2', null);

    // NULL sorts before a past date, so the never-reviewed word is first.
    expect(await texts({ levels: [1, 2, 3], language: 'af' })).toEqual(['huis', 'kat']);
    expect(await texts({ levels: [1, 2, 3], language: 'de' })).toEqual(['haus']);
  });

  test('respects the selected level set', async () => {
    seedSrs('v1', 'een', 'af', 'level1', null);
    seedSrs('v4', 'vier', 'af', 'level4', null);

    expect(await texts({ levels: [1], language: 'af' })).toEqual(['een']);
    expect(await texts({ levels: [4], language: 'af' })).toEqual(['vier']);
    expect(await texts({ levels: [2, 3], language: 'af' })).toEqual([]);
  });

  test('rejects an empty or out-of-range level set', async () => {
    expect((await queue({ levels: [], language: 'af' })).status).toBe(400);
    expect((await queue({ levels: [8], language: 'af' })).status).toBe(400);
    expect((await queue({ language: 'af' })).status).toBe(400);
  });
});
