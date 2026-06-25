import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { db } from '../db';

// The per-language sentence bank is lazily imported by the seed route. Mock the
// Afrikaans bank down to a tiny fixture (2 Tatoeba rows + 1 mined row) so the
// test doesn't seed the full ~11k-row bank.
const TATOEBA_IDS = [9001, 9002];
const MINED_ID = 'afm-test-001';

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

const { default: app } = await import('../routes/cloze');

function setActiveLanguage(code: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'targetLanguage',
    JSON.stringify(code),
  );
}

function reset() {
  db.prepare(
    `DELETE FROM clozeSentences WHERE tatoebaSentenceId IN (${TATOEBA_IDS.join(',')}) OR id = ?`,
  ).run(MINED_ID);
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
      .get(MINED_ID) as { id: string; language: string; source: string; collection: string };
    expect(mined).toBeTruthy();
    expect(mined.source).toBe('mined');
    expect(mined.language).toBe('af');
    expect(mined.collection).toBe('top1000');
  });

  test('seeds nothing when the active language has no bank (no mislabeling)', async () => {
    // The old guard hard-coded 'af'; now a language with no registered bank
    // simply seeds nothing, so Afrikaans content can never land under 'de'.
    setActiveLanguage('de');

    const res = await app.request('/seed', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seeded: number };
    expect(body.seeded).toBe(0);

    const count = db
      .prepare(
        `SELECT COUNT(*) AS c FROM clozeSentences WHERE tatoebaSentenceId IN (${TATOEBA_IDS.join(',')}) OR id = ?`,
      )
      .get(MINED_ID) as { c: number };
    expect(count.c).toBe(0);
  });

  test('re-seeding is idempotent for mined entries', async () => {
    setActiveLanguage('af');
    await app.request('/seed', { method: 'POST' });
    await app.request('/seed', { method: 'POST' });

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM clozeSentences WHERE id = ?')
      .get(MINED_ID) as { c: number };
    expect(count.c).toBe(1);
  });
});
