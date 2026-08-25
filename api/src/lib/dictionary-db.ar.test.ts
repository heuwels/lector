import '../test-guard';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { invalidateDictionaryCache, lookupWord } from './dictionary-db';

// Arabic lookup (#253). Two mechanisms are under test, and they run in a fixed
// order because the order is the design:
//
//   1. The KEY fold. Tashkeel, tatweel and the alef spellings are gone from
//      every key, so the dump's مَدْرَسَة and a newspaper's مدرسة are one row.
//   2. The morphology peel, which runs LAST. Arabic attaches its grammar at
//      both ends of the word with no space, and kaikki enumerates neither end.
//
// Between them sits the loose-spelling fallback, which the build stores as
// alias rows. It has to come after the exact key and before the peel: a word
// spelled مدرسه is the same word, but a word that IS a headword keeps its own
// entry rather than being taken apart.

const FIXTURE_DIR = path.resolve('.test-data', 'dict-ar-fixture');
const previousDictDir = process.env.DICT_DIR;
const USER = 'ar-fixture-user';

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
  const entry = db.prepare('INSERT INTO entries (word, rank, ipa) VALUES (?, ?, ?)');
  const sense = db.prepare('INSERT INTO senses (word, pos, gloss) VALUES (?, ?, ?)');
  const infl = db.prepare('INSERT INTO inflections (inflected_form, lemma, type) VALUES (?, ?, ?)');

  // Every key is stored the way the build stores it: folded. The `ipa` column
  // carries the VOCALIZED spelling, which for this pack is the reading the
  // script hides rather than a phonetic transcription.
  const words: Array<[string, string, string, string]> = [
    ['كتاب', 'noun', 'book', 'كِتَاب'],
    ['مدرسة', 'noun', 'school', 'مَدْرَسَة'],
    ['قلم', 'noun', 'pen', 'قَلَم'],
    ['بيت', 'noun', 'house', 'بَيْت'],
    ['هو', 'pron', 'he', 'هُوَ'],
    ['على', 'prep', 'on, over', 'عَلَى'],
    // Folded from إلى. A key spelled with the hamza would never be hit.
    ['الى', 'prep', 'to, towards', 'إِلَى'],
    ['كتب', 'verb', 'to write', 'كَتَبَ'],
  ];
  for (const [word, pos, gloss, ipa] of words) {
    entry.run(word, 10, ipa);
    sense.run(word, pos, gloss);
  }

  // A real inflection row, folded like the rest.
  infl.run('كتبت', 'كتب', 'feminine,past,third-person');
  // The alias rows the build registers for the loose fold (type 'unpointed').
  infl.run('مدرسه', 'مدرسة', 'unpointed');
  infl.run('علي', 'على', 'unpointed');
  db.close();
  process.env.DICT_DIR = FIXTURE_DIR;
  // Both ar fixture files point DICT_DIR at their own directory, and getDb caches
  // the handle by LANGUAGE, not by path. bun can run them in one process, so
  // without this the second file would read the first file's database and its
  // assertions would pass or fail for the wrong reason.
  invalidateDictionaryCache('ar');
});

afterAll(() => {
  if (previousDictDir === undefined) delete process.env.DICT_DIR;
  else process.env.DICT_DIR = previousDictDir;
  invalidateDictionaryCache('ar');
});

function resolved(word: string): {
  stem: string | undefined;
  gloss: string | undefined;
  label: string | undefined;
  ipa: string | undefined;
} {
  const entry = lookupWord(USER, word, 'ar');
  return {
    stem: entry?.lemmaInfo?.stem ?? entry?.word,
    gloss: entry?.senses?.[0]?.gloss,
    label: entry?.lemmaInfo?.label,
    ipa: entry?.ipa ?? undefined,
  };
}

describe('Arabic key folding (#253)', () => {
  test('a vocalized word hits the unvocalized key', () => {
    const hit = resolved('كِتَاب');
    expect(hit.stem).toBe('كتاب');
    expect(hit.gloss).toBe('book');
  });

  test('a tatweel-stretched word hits the same key', () => {
    expect(resolved('كتـــاب').stem).toBe('كتاب');
  });

  test('an alef spelling folds onto bare alef', () => {
    expect(resolved('إلى').stem).toBe('الى');
    expect(resolved('الى').stem).toBe('الى');
  });

  test('the lookup answers the vocalized spelling', () => {
    // What the popover prints beside the senses, and the reason this pack reads
    // it off the dump's canonical form rather than off sounds[].
    expect(resolved('كتاب').ipa).toBe('كِتَاب');
    expect(resolved('مدرسة').ipa).toBe('مَدْرَسَة');
  });
});

describe('Arabic loose-spelling fallback (step 3-ar)', () => {
  test('ha typed for ta marbuta reaches the entry', () => {
    const hit = resolved('مدرسه');
    expect(hit.stem).toBe('مدرسة');
    expect(hit.gloss).toBe('school');
  });

  test('ya typed for alef maqsura reaches the entry', () => {
    expect(resolved('علي').stem).toBe('على');
  });

  test('an exact headword is never taken to its loose form', () => {
    // على is its own key, so nothing about the fallback should reach it. The
    // exact step has to win, or a genuine minimal pair loses its entry.
    const hit = resolved('على');
    expect(hit.stem).toBe('على');
    expect(hit.label).toBeUndefined();
  });
});

describe('Arabic proclitics and enclitics (step 5-morph)', () => {
  test('peels a conjunction', () => {
    const hit = resolved('وكتاب');
    expect(hit.stem).toBe('كتاب');
    expect(hit.label).toBe('و form of');
  });

  test('peels the definite article', () => {
    expect(resolved('الكتاب').stem).toBe('كتاب');
  });

  test('peels a stack of three proclitics', () => {
    // و + ب + ال + قلم. A one-pass peel answers بالقلم, which is not a key.
    const hit = resolved('وبالقلم');
    expect(hit.stem).toBe('قلم');
    expect(hit.label).toBe('و + ب + ال form of');
  });

  test('peels the fused لل', () => {
    expect(resolved('للمدرسة').stem).toBe('مدرسة');
  });

  test('peels a possessive enclitic', () => {
    const hit = resolved('كتابه');
    expect(hit.stem).toBe('كتاب');
    expect(hit.label).toBe('ه form of');
  });

  test('peels an enclitic and a proclitic together', () => {
    expect(resolved('وكتابه').stem).toBe('كتاب');
    expect(resolved('بيتنا').stem).toBe('بيت');
  });

  test('peels a proclitic off a two-letter function word', () => {
    // The commonest shape in the language, and the one a three-letter stem
    // floor refuses.
    expect(resolved('وهو').stem).toBe('هو');
  });

  test('an exact key is never peeled', () => {
    // كتب is both the verb "to write" and, folded, several other words. It is
    // a headword, so the peel must not reach it and answer كت + ب.
    const hit = resolved('كتب');
    expect(hit.stem).toBe('كتب');
    expect(hit.label).toBeUndefined();
  });

  test('the inflection table wins over the peel', () => {
    const hit = resolved('كتبت');
    expect(hit.stem).toBe('كتب');
    expect(hit.label).toBe('feminine past third-person form of');
  });

  test('an unknown word resolves to nothing rather than to a wrong stem', () => {
    expect(lookupWord(USER, 'زيتون', 'ar')).toBeUndefined();
  });
});
