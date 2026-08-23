import '../test-guard';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { lookupWord } from './dictionary-db';

const FIXTURE_DIR = path.resolve('.test-data', 'dict-it-fixture');
const previousDictDir = process.env.DICT_DIR;
const USER = 'it-fixture-user';

beforeAll(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const db = new Database(path.join(FIXTURE_DIR, 'dictionary-it.db'));
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
    ['italiano', 'noun', 'Italian'],
    ['amica', 'noun', 'friend'],
    ['acqua', 'noun', 'water'],
    ["c'è", 'verb', 'there is'],
    ['è', 'verb', 'is'],
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
  const entry = lookupWord(USER, word, 'it');
  return {
    stem: entry?.lemmaInfo?.stem ?? entry?.word,
    gloss: entry?.senses?.[0]?.gloss,
  };
}

describe('Italian elision lookup', () => {
  test('an exact contraction wins before a prefix peel', () => {
    const hit = resolved("c'è");
    expect(hit.stem).toBe("c'è");
    expect(hit.gloss).toBe('there is');
  });

  test('folds a curly apostrophe onto the same contraction', () => {
    expect(resolved('C’è').stem).toBe("c'è");
    expect(resolved("C'è").gloss).toBe('there is');
  });

  test('peels an article elision when the written form is absent', () => {
    const hit = resolved("l'italiano");
    expect(hit.stem).toBe('italiano');
    expect(hit.gloss).toBe('Italian');
  });

  test('peels after folding a curly apostrophe', () => {
    expect(resolved('l’italiano').stem).toBe('italiano');
    expect(resolved("un'amica").stem).toBe('amica');
    expect(resolved("dell'acqua").stem).toBe('acqua');
  });

  test('folds sentence-initial case on a content word', () => {
    expect(resolved('Italiano').stem).toBe('italiano');
  });
});
