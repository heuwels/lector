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
  const clear = () => {
    db.prepare('DELETE FROM knownWords').run();
    db.prepare('DELETE FROM vocab').run();
    db.prepare('DELETE FROM lessons').run();
    db.prepare('DELETE FROM collections').run();
  };
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

  test('POST accepts the reader lesson reference and rejects a collection id', async () => {
    db.prepare(
      `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId)
       VALUES ('collection-1', 'Reader test', 'Unknown', 'af', ?, ?, 'local')`,
    ).run(TS, TS);
    db.prepare(
      `INSERT INTO lessons
        (id, collectionId, title, textContent, language, createdAt, lastReadAt, userId)
       VALUES ('lesson-1', 'collection-1', 'Chapter', '', 'af', ?, ?, 'local')`,
    ).run(TS, TS);

    const readerSave = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'reader-word',
        text: 'huis',
        type: 'word',
        sentence: 'Die huis is groot.',
        translation: 'house',
        state: 'known',
        stateUpdatedAt: TS,
        reviewCount: 0,
        bookId: 'lesson-1',
        createdAt: TS,
        pushedToAnki: false,
        language: 'af',
      }),
    });
    expect(readerSave.status).toBe(200);
    expect(db.prepare("SELECT bookId FROM vocab WHERE id = 'reader-word'").get()).toEqual({
      bookId: 'lesson-1',
    });

    const wrongTarget = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'wrong-source', text: 'boom', bookId: 'collection-1' }),
    });
    expect(wrongTarget.status).toBe(400);
  });
});

// POST /api/vocab/bulk-delete (#569). The single-row DELETE /:id does two
// things: it drops the vocab row, then drops the matching knownWords row if
// no other vocab entry in that language folds to the same key. Bulk delete
// has to reach the same end state for a whole batch, so most of these tests
// are about the knownWords half rather than the vocab half.

describe('POST /api/vocab/bulk-delete (#569)', () => {
  const clear = () => {
    db.prepare('DELETE FROM knownWords').run();
    db.prepare('DELETE FROM vocab').run();
  };
  beforeEach(clear);
  afterEach(clear);

  function seedKnown(word: string, language: string) {
    db.prepare(
      "INSERT INTO knownWords (userId, word, language, state) VALUES ('local', ?, ?, 'known')",
    ).run(word, language);
  }

  function bulkDelete(vocabIDs: unknown) {
    return app.request('/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vocabIDs }),
    });
  }

  function vocabIds(): string[] {
    const rows = db.prepare('SELECT id FROM vocab ORDER BY id').all() as { id: string }[];
    return rows.map((r) => r.id);
  }

  function knownWords(): Array<{ word: string; language: string }> {
    return db.prepare('SELECT word, language FROM knownWords ORDER BY word').all() as Array<{
      word: string;
      language: string;
    }>;
  }

  test('deletes the listed rows, leaves the rest, and reports the count', async () => {
    seed('v1', 'huis', 'af');
    seed('v2', 'kat', 'af');
    seed('v3', 'boom', 'af');

    const res = await bulkDelete(['v1', 'v3']);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Deleted 2 of 2' });
    expect(vocabIds()).toEqual(['v2']);
  });

  // Regression: the loop body inside db.transaction() is a for-of, so an
  // unknown id has to `continue`. A `return` there abandons every id after it
  // and skips the orphan sweep, silently deleting a fraction of the batch.
  test('an unknown id does not abandon the ids after it', async () => {
    seed('v1', 'huis', 'af');
    seed('v2', 'kat', 'af');
    seedKnown('huis', 'af');
    seedKnown('kat', 'af');

    const res = await bulkDelete(['no-such-id', 'v1', 'v2']);

    expect(await res.json()).toEqual({ success: true, message: 'Deleted 2 of 3' });
    expect(vocabIds()).toEqual([]);
    expect(knownWords()).toEqual([]);
  });

  test('the last vocab row for a word takes its knownWords entry with it', async () => {
    seed('v1', 'huis', 'af');
    seedKnown('huis', 'af');

    await bulkDelete(['v1']);

    expect(knownWords()).toEqual([]);
  });

  // #289: SQLite's LOWER() is ASCII-only, so the survivor check folds in app
  // code. HÄUSER and häuser are one key — deleting either alone must leave
  // the knownWords row standing.
  test('a surviving case variant keeps the knownWords row (#289 folding)', async () => {
    seed('v_upper', 'HÄUSER', 'de');
    seed('v_lower', 'häuser', 'de');
    seedKnown('häuser', 'de');

    await bulkDelete(['v_upper']);
    expect(knownWords()).toEqual([{ word: 'häuser', language: 'de' }]);

    await bulkDelete(['v_lower']);
    expect(knownWords()).toEqual([]);
  });

  // The orphan sweep runs once per language in the batch. A word that is
  // still held by another language must not be swept, and a language absent
  // from the batch must not be touched at all.
  test('a mixed-language batch sweeps each language independently', async () => {
    seed('v_af', 'huis', 'af');
    seed('v_de', 'haus', 'de');
    seed('v_de_keep', 'katze', 'de');
    seedKnown('huis', 'af');
    seedKnown('haus', 'de');
    seedKnown('katze', 'de');

    const res = await bulkDelete(['v_af', 'v_de']);

    expect(await res.json()).toEqual({ success: true, message: 'Deleted 2 of 2' });
    expect(vocabIds()).toEqual(['v_de_keep']);
    expect(knownWords()).toEqual([{ word: 'katze', language: 'de' }]);
  });

  test('the same word in another language keeps its own knownWords row', async () => {
    seed('v_af', 'kat', 'af');
    seed('v_nl', 'kat', 'nl');
    seedKnown('kat', 'af');
    seedKnown('kat', 'nl');

    await bulkDelete(['v_af']);

    expect(knownWords()).toEqual([{ word: 'kat', language: 'nl' }]);
  });

  test('a duplicated id is deleted once and counted once', async () => {
    seed('v1', 'huis', 'af');

    const res = await bulkDelete(['v1', 'v1']);

    expect(await res.json()).toEqual({ success: true, message: 'Deleted 1 of 2' });
    expect(vocabIds()).toEqual([]);
  });

  test('a missing or empty vocabIDs is rejected and deletes nothing', async () => {
    seed('v1', 'huis', 'af');

    expect((await bulkDelete(undefined)).status).toBe(422);
    expect((await bulkDelete([])).status).toBe(422);
    expect(vocabIds()).toEqual(['v1']);
  });

  // A bare string and an object both carry .length, so they clear the
  // emptiness guard. The Array.isArray clause in that same guard is what
  // stops them reaching the id loop and throwing a 500 on the bind.
  test('a non-array vocabIDs is rejected, not a 500', async () => {
    seed('v1', 'huis', 'af');

    expect((await bulkDelete('v1')).status).toBe(422);
    expect((await bulkDelete({ length: 2 })).status).toBe(422);
    expect((await bulkDelete(42)).status).toBe(422);
    expect(vocabIds()).toEqual(['v1']);
  });

  test('an array holding a non-string is rejected, not a 500', async () => {
    seed('v1', 'huis', 'af');

    expect((await bulkDelete([{ id: 'v1' }])).status).toBe(400);
    expect((await bulkDelete([1, 2])).status).toBe(400);
    expect((await bulkDelete(['v1', null])).status).toBe(400);
    expect(vocabIds()).toEqual(['v1']);
  });

  test('malformed JSON is rejected, not a 500', async () => {
    seed('v1', 'huis', 'af');

    const res = await app.request('/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    });

    expect(res.status).toBe(422);
    expect(vocabIds()).toEqual(['v1']);
  });

  test('the batch cap is 200 ids, and a batch over it deletes nothing', async () => {
    seed('v1', 'huis', 'af');

    const atCap = await bulkDelete(Array.from({ length: 200 }, (_, i) => `pad-${i}`));
    expect(atCap.status).toBe(200);

    const overCap = await bulkDelete(['v1', ...Array.from({ length: 200 }, (_, i) => `pad-${i}`)]);
    expect(overCap.status).toBe(422);
    expect(vocabIds()).toEqual(['v1']);
  });
});
