import '../test-guard';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { lookupWord } from './dictionary-db';

const FIXTURE_DIR = path.resolve('.test-data', 'dict-la-fixture');
const previousDictDir = process.env.DICT_DIR;
const USER = 'la-fixture-user';

beforeAll(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const db = new Database(path.join(FIXTURE_DIR, 'dictionary-la.db'));
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
    ['amare', 'verb', 'to love'],
    ['caesar', 'name', 'Caesar'],
    ['gallia', 'name', 'Gaul'],
    ['uult', 'verb', 'wants'],
    ['jam', 'adv', 'already'],
    ['pars', 'noun', 'part'],
  ];
  for (const [word, pos, gloss] of words) {
    entry.run(word, 10);
    sense.run(word, pos, gloss);
  }
  infl.run('partes', 'pars', 'nominative plural');
  db.close();
  process.env.DICT_DIR = FIXTURE_DIR;
});

afterAll(() => {
  if (previousDictDir === undefined) delete process.env.DICT_DIR;
  else process.env.DICT_DIR = previousDictDir;
});

function resolved(word: string): { stem: string | undefined; gloss: string | undefined } {
  const entry = lookupWord(USER, word, 'la');
  return {
    stem: entry?.lemmaInfo?.stem ?? entry?.word,
    gloss: entry?.senses?.[0]?.gloss,
  };
}

describe('Latin lookup folds (#256)', () => {
  test('strips macrons so amāre hits amare', () => {
    const hit = resolved('amāre');
    expect(hit.stem).toBe('amare');
    expect(hit.gloss).toBe('to love');
  });

  test('unfolds æ so Cæsar hits caesar', () => {
    expect(resolved('Cæsar').stem).toBe('caesar');
  });

  test('folds sentence-initial case', () => {
    expect(resolved('GALLIA').stem).toBe('gallia');
  });

  test('resolves an inflected form to its lemma', () => {
    const hit = resolved('partes');
    expect(hit.stem).toBe('pars');
    expect(hit.gloss).toBe('part');
  });

  test('retries u/v when the exact key misses', () => {
    // The fixture stores uult only. A hit on vult can only come from the
    // edition-variant fallback. entry.word stays the query key.
    expect(resolved('vult').gloss).toBe('wants');
  });

  test('retries i/j when the exact key misses', () => {
    expect(resolved('iam').gloss).toBe('already');
  });
});
