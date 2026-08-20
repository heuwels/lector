import '../test-guard';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { lookupReadings } from './dictionary-db';

// Batch pronunciation reads for the reader's annotation layer (#289 4.4). The
// real dictionary-zh.db is a release asset, not a repo file, so this builds a
// miniature one with the production schema and points DICT_DIR at it.

const FIXTURE_DIR = path.resolve('.test-data', 'dict-zh-readings-fixture');
const previousDictDir = process.env.DICT_DIR;

beforeAll(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const db = new Database(path.join(FIXTURE_DIR, 'dictionary-zh.db'));
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
  entry.run('这', 10, 'zhè');
  entry.run('书', 20, 'shū');
  // A headword the zh build keys on its Simplified form. 你好 reaches `entries`
  // only through `inflections`, which is why the batch query needs its alias arm.
  entry.run('nǐhǎo-lemma', 30, 'nǐhǎo');
  // No reading at all — present in the dictionary, absent from the answer.
  db.prepare('INSERT INTO entries (word, rank) VALUES (?, ?)').run('喵', 40);
  // A phonetic transcription, and a reading that is nothing but delimiters.
  entry.run('猫', 50, '[mao]');
  entry.run('狗', 60, '//');

  const alias = db.prepare('INSERT INTO inflections (inflected_form, lemma, type) VALUES (?, ?, ?)');
  alias.run('你好', 'nǐhǎo-lemma', 'headword');
  // The same surface form claimed by two lemmas. The better-ranked one must
  // win, matching how lookupWord resolves an ambiguous inflection.
  alias.run('了', '这', 'headword');
  alias.run('了', '书', 'headword');
  db.close();
  process.env.DICT_DIR = FIXTURE_DIR;
});

afterAll(() => {
  if (previousDictDir === undefined) delete process.env.DICT_DIR;
  else process.env.DICT_DIR = previousDictDir;
});

describe('lookupReadings (#289 4.4)', () => {
  test('reads a direct entry', () => {
    expect(lookupReadings(['这', '书'], 'zh')).toEqual(
      new Map([
        ['这', 'zhè'],
        ['书', 'shū'],
      ]),
    );
  });

  // The load-bearing arm. Without it a Traditional headword, and any Simplified
  // form the build filed as an alias, gets no reading at all.
  test('reads an entry reachable only through inflections', () => {
    expect(lookupReadings(['你好'], 'zh')).toEqual(new Map([['你好', 'nǐhǎo']]));
  });

  test('prefers the better-ranked lemma for an ambiguous form', () => {
    expect(lookupReadings(['了'], 'zh')).toEqual(new Map([['了', 'zhè']]));
  });

  test('omits a word with no reading and a word not in the dictionary', () => {
    expect(lookupReadings(['喵', '龘'], 'zh')).toEqual(new Map());
  });

  test('answers one entry for a word the page repeats', () => {
    expect(lookupReadings(['这', '这', '这'], 'zh')).toEqual(new Map([['这', 'zhè']]));
  });

  test('answers nothing for no words', () => {
    expect(lookupReadings([], 'zh')).toEqual(new Map());
  });

  test('answers nothing for a language with no dictionary file', () => {
    expect(lookupReadings(['huis'], 'af')).toEqual(new Map());
  });

  // A phonetic transcription in square brackets is stripped the same way, and a
  // reading that is nothing but delimiters is left alone rather than emptied.
  test('strips a bracketed transcription and keeps a bare one', () => {
    expect(lookupReadings(['猫'], 'zh').get('猫')).toBe('mao');
    expect(lookupReadings(['狗'], 'zh').get('狗')).toBe('//');
  });
});
