import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';

const { default: app } = await import('../routes/practice');

// POST /api/practice/srs-queue — the SRS review picker. Two invariants matter
// beyond the level/date window: it must stay inside one language (a global
// query surfaced other languages' words before this), and it must respect the
// requested level set.

const TS = '2026-01-01T00:00:00Z';
const DUE = '2025-01-01T00:00:00Z';
const FUTURE = '2999-01-01T00:00:00Z';

function seedSrs(
  id: string,
  text: string,
  language: string,
  level: number,
  nextReview: string | null,
) {
  db.prepare(
    `INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, createdAt, language, srs_level, next_review)
     VALUES (?, ?, 'word', 's', 't', 'new', ?, ?, ?, ?, ?)`,
  ).run(id, text, TS, TS, language, level, nextReview);
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

  test('returns only the requested language’s due words', async () => {
    seedSrs('v_af', 'huis', 'af', 1, DUE);
    seedSrs('v_de', 'haus', 'de', 1, DUE);
    seedSrs('v_af_future', 'kat', 'af', 1, FUTURE);
    seedSrs('v_af_unscheduled', 'boom', 'af', 1, null);

    expect(await texts({ levels: [1, 2, 3], language: 'af' })).toEqual(['huis']);
    expect(await texts({ levels: [1, 2, 3], language: 'de' })).toEqual(['haus']);
  });

  test('respects the selected level set', async () => {
    seedSrs('v1', 'een', 'af', 1, DUE);
    seedSrs('v4', 'vier', 'af', 4, DUE);

    expect(await texts({ levels: [1], language: 'af' })).toEqual(['een']);
    expect(await texts({ levels: [4], language: 'af' })).toEqual(['vier']);
  });

  test('rejects an empty or out-of-range level set', async () => {
    expect((await queue({ levels: [], language: 'af' })).status).toBe(400);
    expect((await queue({ levels: [8], language: 'af' })).status).toBe(400);
    expect((await queue({ language: 'af' })).status).toBe(400);
  });
});
