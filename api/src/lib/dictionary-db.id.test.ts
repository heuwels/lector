import '../test-guard';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { lookupWord } from './dictionary-db';

const FIXTURE_DIR = path.resolve('.test-data', 'dict-id-fixture');
const previousDictDir = process.env.DICT_DIR;
const USER = 'id-fixture-user';

beforeAll(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const db = new Database(path.join(FIXTURE_DIR, 'dictionary-id.db'));
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

  const words: Array<[string, string, string]> = [
    ['buku', 'noun', 'book'],
    ['beli', 'verb', 'to buy'],
    ['nama', 'noun', 'name'],
    ['tahan', 'verb', 'to endure'],
    ['alami', 'verb', 'to experience'],
    ['membeli', 'verb', 'to buy'],
  ];
  for (const [word, pos, gloss] of words) {
    entry.run(word, 10);
    sense.run(word, pos, gloss);
  }
  db.close();
  process.env.DICT_DIR = FIXTURE_DIR;
});

afterAll(() => {
  if (previousDictDir === undefined) delete process.env.DICT_DIR;
  else process.env.DICT_DIR = previousDictDir;
});

function resolved(word: string): { stem: string | undefined; gloss: string | undefined } {
  const entry = lookupWord(USER, word, 'id');
  return {
    stem: entry?.lemmaInfo?.stem ?? entry?.word,
    gloss: entry?.senses?.[0]?.gloss,
  };
}

describe('Indonesian morphology lookup', () => {
  test('an exact derived form wins before a prefix peel', () => {
    const hit = resolved('membeli');
    expect(hit.stem).toBe('membeli');
    expect(hit.gloss).toBe('to buy');
  });

  test('peels a possessive clitic', () => {
    const hit = resolved('namanya');
    expect(hit.stem).toBe('nama');
    expect(hit.gloss).toBe('name');
  });

  test('peels a voice prefix when the derived form is absent', () => {
    const hit = resolved('bertahan');
    expect(hit.stem).toBe('tahan');
    expect(hit.gloss).toBe('to endure');
  });

  test('peels a clitic then a prefix', () => {
    const hit = resolved('mengalaminya');
    expect(hit.stem).toBe('alami');
    expect(hit.gloss).toBe('to experience');
  });

  test('folds sentence-initial case', () => {
    expect(resolved('Buku').stem).toBe('buku');
  });
});
