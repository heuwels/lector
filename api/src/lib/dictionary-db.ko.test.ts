import '../test-guard';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { lookupWord } from './dictionary-db';

// Korean postposition and ending peeling (#289). The real dictionary-ko.db is a
// release asset, so this builds a miniature one with the production schema and
// points DICT_DIR at it.
//
// Every case here is measured against the shipped dictionary as well: the
// coverage gate in scripts/build-dictionary.ts runs the same stemCandidates
// over 5,000 Tatoeba eojeol and answers 93.5% of them.

const FIXTURE_DIR = path.resolve('.test-data', 'dict-ko-fixture');
const previousDictDir = process.env.DICT_DIR;
const USER = 'ko-fixture-user';

beforeAll(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const db = new Database(path.join(FIXTURE_DIR, 'dictionary-ko.db'));
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
  const inflection = db.prepare(
    'INSERT INTO inflections (inflected_form, lemma, type) VALUES (?, ?, ?)',
  );

  const words: Array<[string, string, string]> = [
    ['도서관', 'noun', 'library'],
    ['학생', 'noun', 'student'],
    ['집', 'noun', 'house'],
    ['사람', 'noun', 'person'],
    ['친구', 'noun', 'friend'],
    ['먹다', 'verb', 'to eat'],
    ['좋아하다', 'verb', 'to like'],
    ['좋다', 'adj', 'to be good'],
    // The trap this suite exists for. 보다 is the verb "to see" AND the
    // comparative postposition, and 나 is the pronoun "I" AND the "or"
    // postposition. An exact key has to beat every peel.
    ['보다', 'verb', 'to see'],
    ['나', 'pron', 'I'],
    ['도', 'noun', 'province'],
  ];
  for (const [word, pos, gloss] of words) {
    entry.run(word, 10);
    sense.run(word, pos, gloss);
  }
  // The finite conjugation kaikki DOES enumerate. These rows are why Korean
  // needs no morphological analyser.
  inflection.run('먹었어요', '먹다', 'indicative,informal,past,polite');
  inflection.run('먹습니다', '먹다', 'formal,indicative,non-past,polite');
  db.close();
  process.env.DICT_DIR = FIXTURE_DIR;
});

afterAll(() => {
  if (previousDictDir === undefined) delete process.env.DICT_DIR;
  else process.env.DICT_DIR = previousDictDir;
});

// `word` on the answer is the form the reader tapped, and the entry it resolved
// to is in `lemmaInfo.stem`. A gloss proves it read the right entry's senses.
function resolved(word: string): { stem: string | undefined; gloss: string | undefined } {
  const entry = lookupWord(USER, word, 'ko');
  return { stem: entry?.lemmaInfo?.stem, gloss: entry?.senses[0]?.gloss };
}

function lookup(word: string) {
  return lookupWord(USER, word, 'ko');
}

describe('Korean lookup through postpositions and endings (#289)', () => {
  test('peels one postposition off a noun', () => {
    expect(resolved('도서관에서')).toEqual({ stem: '도서관', gloss: 'library' });
    expect(resolved('학생이')).toEqual({ stem: '학생', gloss: 'student' });
    expect(resolved('집에')).toEqual({ stem: '집', gloss: 'house' });
  });

  test('peels a stack of two', () => {
    expect(resolved('도서관에서는')).toEqual({ stem: '도서관', gloss: 'library' });
  });

  test('peels the plural under a postposition', () => {
    expect(resolved('학생들은')).toEqual({ stem: '학생', gloss: 'student' });
  });

  test('peels the copula off a noun', () => {
    expect(resolved('사람입니다')).toEqual({ stem: '사람', gloss: 'person' });
    expect(resolved('사람이에요')).toEqual({ stem: '사람', gloss: 'person' });
    expect(resolved('친구야')).toEqual({ stem: '친구', gloss: 'friend' });
  });

  test('resolves a conjugated verb through the inflections table', () => {
    expect(resolved('먹었어요')).toEqual({ stem: '먹다', gloss: 'to eat' });
    expect(resolved('먹습니다')).toEqual({ stem: '먹다', gloss: 'to eat' });
  });

  test('appends the citation suffix for an ending the dump leaves out', () => {
    expect(resolved('좋아하지')).toEqual({ stem: '좋아하다', gloss: 'to like' });
    expect(resolved('먹으러')).toEqual({ stem: '먹다', gloss: 'to eat' });
    expect(resolved('먹을래')).toEqual({ stem: '먹다', gloss: 'to eat' });
  });

  // The whole reason the step runs last.
  test('a headword beats every peel', () => {
    expect(lookup('보다')?.senses[0]?.gloss).toBe('to see');
    expect(lookup('보다')?.lemmaInfo).toBeUndefined();
    expect(lookup('나')?.senses[0]?.gloss).toBe('I');
    expect(lookup('나')?.lemmaInfo).toBeUndefined();
    expect(lookup('도')?.senses[0]?.gloss).toBe('province');
    expect(lookup('도')?.lemmaInfo).toBeUndefined();
  });

  test('names what it peeled', () => {
    expect(lookup('도서관에서')?.lemmaInfo).toEqual({ stem: '도서관', label: '에서 form of' });
    expect(lookup('도서관에서는')?.lemmaInfo).toEqual({
      stem: '도서관',
      label: '는 + 에서 form of',
    });
    expect(lookup('좋아하지')?.lemmaInfo).toEqual({ stem: '좋아하다', label: '지 form of' });
  });

  test('answers nothing when no peel reaches an entry', () => {
    expect(lookup('없는단어')).toBeUndefined();
  });

  // Deliberately NO other language here. This file points DICT_DIR at a ko-only
  // fixture, and the module caches one connection per language for the life of
  // the process. Touching zh or ja from here caches it as "no dictionary" and
  // fails the fixture suite that runs later.
});
