import '../test-guard';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { invalidateDictionaryCache, lookupWord } from './dictionary-db';

const FIXTURE_DIR = path.resolve('.test-data', 'dict-hbo-fixture');
const previousDictDir = process.env.DICT_DIR;
const USER = 'hbo-fixture-user';

beforeAll(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const db = new Database(path.join(FIXTURE_DIR, 'dictionary-hbo.db'));
  db.exec(`
    CREATE TABLE entries (word TEXT PRIMARY KEY, rank INTEGER, ipa TEXT, etymology TEXT);
    CREATE TABLE senses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL, pos TEXT, gloss TEXT NOT NULL, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE related_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL, related_word TEXT NOT NULL, relation TEXT NOT NULL
    );
    CREATE TABLE inflections (
      inflected_form TEXT NOT NULL, lemma TEXT NOT NULL, type TEXT,
      PRIMARY KEY (inflected_form, lemma)
    );
  `);
  const entry = db.prepare('INSERT INTO entries (word, rank) VALUES (?, ?)');
  const sense = db.prepare('INSERT INTO senses (word, pos, gloss) VALUES (?, ?, ?)');
  const infl = db.prepare('INSERT INTO inflections (inflected_form, lemma, type) VALUES (?, ?, ?)');

  const words: Array<[string, string, string]> = [
    ['גם', 'adv', 'also, even'],
    ['שניהם', 'pron', 'both of them'],
    ['שמים', 'noun', 'heavens'],
  ];
  for (const [word, pos, gloss] of words) {
    entry.run(word, 10);
    sense.run(word, pos, gloss);
  }
  infl.run('שמימ', 'שמים', 'unpointed');
  db.close();
  process.env.DICT_DIR = FIXTURE_DIR;
  invalidateDictionaryCache('hbo');
});

afterAll(() => {
  if (previousDictDir === undefined) delete process.env.DICT_DIR;
  else process.env.DICT_DIR = previousDictDir;
  invalidateDictionaryCache('hbo');
});

function resolved(word: string): { stem: string | undefined; gloss: string | undefined } {
  const entry = lookupWord(USER, word, 'hbo');
  return {
    stem: entry?.lemmaInfo?.stem ?? entry?.word,
    gloss: entry?.senses?.[0]?.gloss,
  };
}

describe('Biblical Hebrew maqaf lookup (#255)', () => {
  test('a maqaf-joined token resolves to the host word', () => {
    const hit = resolved('גַם־שְׁנֵיהֶם');
    expect(hit.stem).toBe('שניהם');
    expect(hit.gloss).toBe('both of them');
  });

  test('the host peels a prefix after the split', () => {
    const hit = resolved('אֵת־הַשָּׁמַיִם');
    expect(hit.stem).toBe('שמים');
    expect(hit.gloss).toBe('heavens');
  });
});
