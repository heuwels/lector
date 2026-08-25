import '../test-guard';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { invalidateDictionaryCache, lookupWord } from './dictionary-db';

// The hamza carriers must NOT be folded by any lookup step (#253).
//
// This is a regression guard on a real bug. Arabic sets
// `practiceLeniency: 'fold-marks'`, which is a statement about what a typed
// practice answer may omit. The dictionary's accent-insensitive fallback was
// keyed off that same setting, so Arabic inherited grc's mark-stripping — and
// NFD splits ؤ into و + U+0654 and ئ into ي + U+0654, so stripping every
// \p{M} rewrites those two letters.
//
// Measured on the shipped dictionary: 817 of 25,750 entries change under the
// strip, and 51 of them land on a DIFFERENT real entry. رؤية ("seeing") would
// have been answered by روية ("deliberation") and جرؤ ("to dare") by جرو
// ("cub"). A confident wrong answer is worse than a miss, so the fallback is
// gated on the language that has the alias rows for it.

const FIXTURE_DIR = path.resolve('.test-data', 'dict-ar-hamza-fixture');
const previousDictDir = process.env.DICT_DIR;
const USER = 'ar-hamza-user';

beforeAll(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const db = new Database(path.join(FIXTURE_DIR, 'dictionary-ar.db'));
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
  // The two halves of a real collision pair from the shipped dictionary. Only
  // the waw-spelled one is stored, so a lookup of the hamza-spelled word can
  // only succeed by folding — which is the thing that must not happen.
  for (const [word, pos, gloss] of [
    ['روية', 'noun', 'deliberation, advice'],
    ['جرو', 'noun', 'cub; puppy'],
    ['كتاب', 'noun', 'book'],
  ] as Array<[string, string, string]>) {
    entry.run(word, 10);
    sense.run(word, pos, gloss);
  }
  db.close();
  process.env.DICT_DIR = FIXTURE_DIR;
  // See the note in dictionary-db.ar.test.ts: the cache is keyed by language, so
  // each ar fixture has to drop the other's handle on the way in and out.
  invalidateDictionaryCache('ar');
});

afterAll(() => {
  if (previousDictDir === undefined) delete process.env.DICT_DIR;
  else process.env.DICT_DIR = previousDictDir;
  invalidateDictionaryCache('ar');
});

describe('Arabic hamza carriers are never folded by a lookup (#253)', () => {
  test('رؤية is not answered by روية', () => {
    expect(lookupWord(USER, 'رؤية', 'ar')).toBeUndefined();
  });

  test('جرؤ is not answered by جرو', () => {
    expect(lookupWord(USER, 'جرؤ', 'ar')).toBeUndefined();
  });

  test('the same lookup still resolves a word that really is stored', () => {
    // Proves the misses above are the fold being absent, not the fixture being
    // unreachable.
    expect(lookupWord(USER, 'كتاب', 'ar')?.senses?.[0]?.gloss).toBe('book');
  });
});
