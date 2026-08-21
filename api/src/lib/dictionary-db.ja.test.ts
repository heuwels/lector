import '../test-guard';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { lookupReadings } from './dictionary-db';

// Furigana for the reader's annotation layer (#214). The real dictionary-ja.db
// is a release asset, so this builds a miniature one with the production schema
// and points DICT_DIR at it.

const FIXTURE_DIR = path.resolve('.test-data', 'dict-ja-fixture');
const previousDictDir = process.env.DICT_DIR;

beforeAll(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const db = new Database(path.join(FIXTURE_DIR, 'dictionary-ja.db'));
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
  entry.run('図書館', 10, 'としょかん');
  entry.run('東京', 20, 'とうきょう');
  entry.run('新しい', 30, 'あたらしい');
  // The trap this suite exists for. Several single kana are also archaic
  // kanji-words, so the dictionary really does hold a reading for them, and it
  // has nothing to do with the particle a reader sees.
  entry.run('を', 40, 'あく');
  entry.run('へ', 50, 'ほう');
  entry.run('ます', 60, 'もうす');
  // A katakana word is its own reading, so it needs no annotation.
  entry.run('コーヒー', 70, 'こーひー');
  db.close();
  process.env.DICT_DIR = FIXTURE_DIR;
});

afterAll(() => {
  if (previousDictDir === undefined) delete process.env.DICT_DIR;
  else process.env.DICT_DIR = previousDictDir;
});

describe('Japanese furigana lookup (#214)', () => {
  test('answers a kanji word with its kana reading', () => {
    expect(lookupReadings(['図書館', '東京', '新しい'], 'ja')).toEqual(
      new Map([
        ['図書館', 'としょかん'],
        ['東京', 'とうきょう'],
        ['新しい', 'あたらしい'],
      ]),
    );
  });

  // The reason `annotationRequires` exists. Without it the reader printed あく
  // above を and もうす above ます, which teaches an error rather than a reading.
  test('never annotates a kana word, even when the dictionary has one', () => {
    expect(lookupReadings(['を', 'へ', 'ます'], 'ja')).toEqual(new Map());
  });

  test('never annotates katakana', () => {
    expect(lookupReadings(['コーヒー'], 'ja')).toEqual(new Map());
  });

  test('keeps the kanji words out of a mixed sentence and drops the rest', () => {
    const readings = lookupReadings(['東京', 'へ', '行き', 'ます'], 'ja');
    expect(readings.get('東京')).toBe('とうきょう');
    expect(readings.has('へ')).toBe(false);
    expect(readings.has('ます')).toBe(false);
  });

  // Deliberately NO zh case here. This file points DICT_DIR at a ja-only
  // fixture, and the module caches one connection per language for the life of
  // the process. Touching zh from here caches it as "no dictionary" and fails
  // the zh fixture suite that runs later. dictionary-db.readings.test.ts owns
  // the zh side.
});
