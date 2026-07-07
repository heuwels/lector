import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';

const { default: app } = await import('../routes/vocab');

// GET /api/vocab ?text= filter (#240): the reader's word-click lookup used to
// fetch the whole language-scoped vocab list and .find() client-side. The
// server now filters by exact text (callers pass the lowercased word), backed
// by idx_vocab_user_lang_text.

const TS = '2026-01-01T00:00:00Z';

function seed(id: string, text: string, language: string, createdAt = TS) {
  db.prepare(
    `INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, createdAt, language)
     VALUES (?, ?, 'word', 's', 't', 'new', ?, ?, ?)`,
  ).run(id, text, TS, createdAt, language);
}

describe('GET /api/vocab?text= (#240)', () => {
  const clear = () => db.prepare('DELETE FROM vocab').run();
  beforeEach(clear);
  afterEach(clear);

  test('returns only rows matching the exact text, scoped to the language', async () => {
    seed('v1', 'huis', 'af');
    seed('v2', 'huisie', 'af'); // prefix — must not match
    seed('v3', 'huis', 'de'); // other language — must not match

    const res = await app.request('/?language=af&text=huis');
    const rows = (await res.json()) as { id: string; text: string }[];
    expect(rows.map((r) => r.id)).toEqual(['v1']);
  });

  test('newest match comes first (what getVocabByText takes)', async () => {
    seed('v_old', 'kat', 'af', '2026-01-01T00:00:00Z');
    seed('v_new', 'kat', 'af', '2026-02-01T00:00:00Z');

    const res = await app.request('/?language=af&text=kat');
    const rows = (await res.json()) as { id: string }[];
    expect(rows[0].id).toBe('v_new');
    expect(rows.length).toBe(2);
  });

  test('no match returns an empty list; absent text returns everything', async () => {
    seed('v1', 'huis', 'af');

    const none = (await (await app.request('/?language=af&text=boom')).json()) as unknown[];
    expect(none).toEqual([]);

    const all = (await (await app.request('/?language=af')).json()) as unknown[];
    expect(all.length).toBe(1);
  });
});
