import '../test-guard';
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { db } from '../db';

// The per-language sentence bank is lazily imported by the seed route. Mock the
// Afrikaans bank down to a tiny fixture (2 Tatoeba rows + 1 mined row) so the
// test doesn't seed the full ~11k-row bank.
const TATOEBA_IDS = [9001, 9002];
const MINED_ID = 'afm-test-001';
// Mined rows are stored under a per-tenant namespaced id (#220) — these tests
// run in selfhost mode, so the stored PK is the 'local' user's namespace.
const STORED_MINED_ID = `mined:local:${MINED_ID}`;
const DE_TATOEBA_IDS = [7001, 7002];
const FR_TATOEBA_IDS = [6001, 6002];
const NL_TATOEBA_IDS = [5001, 5002];

mock.module('../lib/sentence-bank-af.json', () => ({
  default: [
    {
      id: 9001,
      text: 'Die kat sit op die mat.',
      translation: 'The cat sits on the mat.',
      clozeWord: 'kat',
      clozeIndex: 1,
      wordRank: 50,
      collection: 'top500',
    },
    {
      id: 9002,
      text: 'Ek drink water.',
      translation: 'I drink water.',
      clozeWord: 'water',
      clozeIndex: 2,
      wordRank: 120,
      collection: 'top500',
    },
    {
      id: MINED_ID,
      text: 'Die hond is lekker.',
      translation: 'The dog is nice.',
      clozeWord: 'hond',
      clozeIndex: 1,
      wordRank: 300,
      collection: 'top1000',
      source: 'mined',
    },
  ],
}));

// German bank fixture (2 rows) — proves per-language seeding + isolation.
mock.module('../lib/sentence-bank-de.json', () => ({
  default: [
    {
      id: 7001,
      text: 'Das Haus ist groß.',
      translation: 'The house is big.',
      clozeWord: 'Haus',
      clozeIndex: 1,
      wordRank: 40,
      collection: 'top500',
    },
    {
      id: 7002,
      text: 'Ich trinke Wasser.',
      translation: 'I drink water.',
      clozeWord: 'Wasser',
      clozeIndex: 2,
      wordRank: 90,
      collection: 'top500',
    },
  ],
}));

// Spanish ships a real bank in production (sentence-bank-es.json); mocked empty
// here so the "no usable bank" test below exercises the seeds-nothing guard
// without importing the full ~8k-row bank.
mock.module('../lib/sentence-bank-es.json', () => ({ default: [] }));

// French bank fixture (2 rows) — proves the fourth language seeds under fr and
// stays isolated, once its bank is registered in SENTENCE_BANKS (the one-line
// cloze.ts change); everything else about fr is registry-derived.
mock.module('../lib/sentence-bank-fr.json', () => ({
  default: [
    {
      id: 6001,
      text: 'Le chat dort sur le lit.',
      translation: 'The cat sleeps on the bed.',
      clozeWord: 'chat',
      clozeIndex: 1,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 6002,
      text: 'Je bois du café chaud.',
      translation: 'I drink hot coffee.',
      clozeWord: 'café',
      clozeIndex: 3,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

// Dutch bank fixture (2 rows) — proves the fifth language seeds under nl and
// stays isolated, once its bank is registered in SENTENCE_BANKS (the one-line
// cloze.ts change); everything else about nl is registry-derived.
mock.module('../lib/sentence-bank-nl.json', () => ({
  default: [
    {
      id: 5001,
      text: 'De kat slaapt op het bed.',
      translation: 'The cat sleeps on the bed.',
      clozeWord: 'kat',
      clozeIndex: 1,
      wordRank: 45,
      collection: 'top500',
    },
    {
      id: 5002,
      text: 'Ik drink warme koffie.',
      translation: 'I drink hot coffee.',
      clozeWord: 'koffie',
      clozeIndex: 3,
      wordRank: 110,
      collection: 'top500',
    },
  ],
}));

const { default: app } = await import('../routes/cloze');

function setActiveLanguage(code: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'targetLanguage',
    JSON.stringify(code),
  );
}

function reset() {
  db.prepare(
    `DELETE FROM clozeSentences WHERE tatoebaSentenceId IN (${[...TATOEBA_IDS, ...DE_TATOEBA_IDS, ...FR_TATOEBA_IDS, ...NL_TATOEBA_IDS].join(',')}) OR id IN (?, ?)`,
  ).run(MINED_ID, STORED_MINED_ID);
  db.prepare("DELETE FROM settings WHERE key = 'targetLanguage'").run();
}

describe('POST /api/cloze/seed — lazy per-language bank', () => {
  beforeEach(reset);
  afterEach(reset);

  test('seeds the active language bank and stores rows under that language', async () => {
    setActiveLanguage('af');

    const res = await app.request('/seed', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seeded: number; mined: number; tatoeba: number };
    expect(body.seeded).toBe(3);
    expect(body.tatoeba).toBe(2);
    expect(body.mined).toBe(1);

    const tat = db
      .prepare(
        `SELECT language, source FROM clozeSentences WHERE tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string; source: string }[];
    expect(tat.length).toBe(2);
    expect(tat.every((r) => r.language === 'af' && r.source === 'tatoeba')).toBe(true);

    const mined = db
      .prepare('SELECT id, language, source, collection FROM clozeSentences WHERE id = ?')
      .get(STORED_MINED_ID) as { id: string; language: string; source: string; collection: string };
    expect(mined).toBeTruthy();
    expect(mined.source).toBe('mined');
    expect(mined.language).toBe('af');
    expect(mined.collection).toBe('top1000');
  });

  test('seeds nothing when the active language has no bank (no mislabeling)', async () => {
    // A registered language whose bank has no usable sentences (es is mocked to
    // an empty bank above) simply seeds nothing, so one language's content can
    // never land under another.
    setActiveLanguage('es');

    const res = await app.request('/seed', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(0);

    const count = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE tatoebaSentenceId IN (${TATOEBA_IDS.join(',')}) OR id = ?`,
      )
      .get(STORED_MINED_ID) as { c: number };
    expect(count.c).toBe(0);
  });

  test('seeds the German bank under de, isolated from Afrikaans (no cross-bleed)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('de');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const de = db
      .prepare(
        `SELECT language FROM clozeSentences WHERE tatoebaSentenceId IN (${DE_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string }[];
    expect(de.length).toBe(2);
    expect(de.every((r) => r.language === 'de')).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under de.
    const afUnderDe = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'de' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderDe.c).toBe(0);
  });

  test('seeds the French bank under fr, isolated from Afrikaans (fourth language)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('fr');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const fr = db
      .prepare(
        `SELECT language FROM clozeSentences WHERE tatoebaSentenceId IN (${FR_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string }[];
    expect(fr.length).toBe(2);
    expect(fr.every((r) => r.language === 'fr')).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under fr.
    const afUnderFr = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'fr' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderFr.c).toBe(0);
  });

  test('seeds the Dutch bank under nl, isolated from Afrikaans (fifth language)', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    setActiveLanguage('nl');
    const res = await app.request('/seed', { method: 'POST' });
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(2);

    const nl = db
      .prepare(
        `SELECT language FROM clozeSentences WHERE tatoebaSentenceId IN (${NL_TATOEBA_IDS.join(',')})`,
      )
      .all() as { language: string }[];
    expect(nl.length).toBe(2);
    expect(nl.every((r) => r.language === 'nl')).toBe(true);

    // Zero cross-bleed: Afrikaans content never lands under nl.
    const afUnderNl = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE language = 'nl' AND tatoebaSentenceId IN (${TATOEBA_IDS.join(',')})`,
      )
      .get() as { c: number };
    expect(afUnderNl.c).toBe(0);
  });

  test('re-seeding is idempotent for mined entries', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    await app.request('/seed', { method: 'POST' });

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM clozeSentences WHERE id = ?')
      .get(STORED_MINED_ID) as { c: number };
    expect(count.c).toBe(1);
  });

  test('a mined row seeded before id namespacing is not duplicated on re-seed', async () => {
    setActiveLanguage('af');
    // Legacy row: the raw bank id, as pre-#220 seeds stored it.
    db.prepare(
      `INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, nextReview, language, userId)
       VALUES (?, 'Ou saad-ry.', 'saad', 0, 'x', 'mined', 'top1000', ?, 'af', 'local')`,
    ).run(MINED_ID, new Date().toISOString());

    const body = (await (await app.request('/seed', { method: 'POST' })).json()) as { mined: number };
    // The legacy raw-id row is recognized as already-seeded — no namespaced duplicate.
    expect(body.mined).toBe(0);

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM clozeSentences WHERE id IN (?, ?)')
      .get(MINED_ID, STORED_MINED_ID) as { c: number };
    expect(count.c).toBe(1);
  });
});

describe('GET /api/cloze/stats — server-side totals (#240)', () => {
  const clear = () => db.prepare(`DELETE FROM clozeSentences WHERE id IN ('stat1','stat2','stat3')`).run();
  beforeEach(clear);
  afterEach(clear);

  test('sums timesCorrect/timesIncorrect for the language only', async () => {
    const insert = db.prepare(`
      INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, nextReview, timesCorrect, timesIncorrect, language)
      VALUES (?, 's', 'w', 0, 't', 'tatoeba', 'random', '2026-01-01', ?, ?, ?)
    `);
    insert.run('stat1', 3, 1, 'af');
    insert.run('stat2', 4, 2, 'af');
    insert.run('stat3', 100, 100, 'de'); // other language — excluded

    const res = await app.request('/stats?language=af');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ timesCorrect: 7, timesIncorrect: 3 });
  });

  test('empty table sums to zeros, not nulls', async () => {
    const res = await app.request('/stats?language=af');
    expect(await res.json()).toEqual({ timesCorrect: 0, timesIncorrect: 0 });
  });
});
