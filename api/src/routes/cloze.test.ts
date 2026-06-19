import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { db } from '../db';

// The bundled sentence bank is Afrikaans content. Mock it down to a tiny
// fixture so the test doesn't seed the full ~thousand-row bank.
const FIXTURE_IDS = [9001, 9002];

mock.module('../lib/sentence-bank.json', () => ({
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
    `DELETE FROM clozeSentences WHERE tatoebaSentenceId IN (${FIXTURE_IDS.join(',')})`,
  ).run();
  db.prepare("DELETE FROM settings WHERE key = 'targetLanguage'").run();
}

describe('POST /api/cloze/seed — bank language', () => {
  beforeEach(reset);
  afterEach(reset);

  test('labels seeded sentences as Afrikaans even when another language is active', async () => {
    // Regression guard: seeding used to stamp rows with the active language,
    // so seeding under German filled the German deck with Afrikaans sentences.
    setActiveLanguage('de');

    const res = await app.request('/seed', { method: 'POST' });
    expect(res.status).toBe(200);

    const rows = db
      .prepare(
        `SELECT language FROM clozeSentences WHERE tatoebaSentenceId IN (${FIXTURE_IDS.join(',')})`,
      )
      .all() as { language: string }[];
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.language === 'af')).toBe(true);
  });
});
