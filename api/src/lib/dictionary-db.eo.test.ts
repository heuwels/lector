import '../test-guard';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { lookupWord } from './dictionary-db';

// Esperanto rule-based morphology (#307 §3.3) + x-system fold (§3.4) + rule
// IPA attachment (§3.2b), against a hermetic fixture dictionary — the real
// dictionary-eo.db is a release asset, not a repo file, so tests build a
// miniature one with the production schema and point DICT_DIR at it.

const FIXTURE_DIR = path.resolve('.test-data', 'dict-eo-fixture');
const previousDictDir = process.env.DICT_DIR;

// (word, pos, gloss) — deliberately WITHOUT any derived/compound forms, so a
// hit on those can only come from the rule analyzer.
const ENTRIES: Array<[string, string, string]> = [
  ['domo', 'noun', 'house'],
  ['bela', 'adj', 'beautiful'],
  ['sano', 'noun', 'health'],
  ['sana', 'adj', 'healthy'],
  ['ŝipo', 'noun', 'ship'],
  ['paroli', 'verb', 'to speak'],
  ['kuri', 'verb', 'to run'],
  ['ĉu', 'particle', 'whether; question particle'],
];

beforeAll(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const db = new Database(path.join(FIXTURE_DIR, 'dictionary-eo.db'));
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
  const insertEntry = db.prepare('INSERT INTO entries (word) VALUES (?)');
  const insertSense = db.prepare('INSERT INTO senses (word, pos, gloss) VALUES (?, ?, ?)');
  for (const [word, pos, gloss] of ENTRIES) {
    insertEntry.run(word);
    insertSense.run(word, pos, gloss);
  }
  // One kaikki-style form-of row, to prove the inflections table still wins
  // over the rule analyzer.
  db.prepare('INSERT INTO inflections (inflected_form, lemma, type) VALUES (?, ?, ?)').run(
    'parolas',
    'paroli',
    'present',
  );
  db.close();
  process.env.DICT_DIR = FIXTURE_DIR;
});

afterAll(() => {
  if (previousDictDir === undefined) delete process.env.DICT_DIR;
  else process.env.DICT_DIR = previousDictDir;
});

describe('Esperanto rule-based lookup (#307 §3.3)', () => {
  test('exact hits carry the rule-generated IPA gloss', () => {
    const entry = lookupWord('local', 'domo', 'eo');
    expect(entry?.senses[0]?.gloss).toBe('house');
    expect(entry?.ipa).toBe('/ˈdomo/');
  });

  test('grammatical endings strip cleanly: -n, -j, -jn', () => {
    const acc = lookupWord('local', 'domon', 'eo');
    expect(acc?.lemmaInfo).toEqual({ stem: 'domo', label: 'accusative of' });

    const plural = lookupWord('local', 'belaj', 'eo');
    expect(plural?.lemmaInfo).toEqual({ stem: 'bela', label: 'plural of' });

    const both = lookupWord('local', 'domojn', 'eo');
    expect(both?.lemmaInfo).toEqual({ stem: 'domo', label: 'accusative plural of' });
    // The gloss is the surface form's — pronunciation is regular even for
    // forms kaikki never carries.
    expect(both?.ipa).toBe('/ˈdomojn/');
  });

  test('finite verbs resolve to the infinitive lemma by rule', () => {
    expect(lookupWord('local', 'parolis', 'eo')?.lemmaInfo).toEqual({
      stem: 'paroli',
      label: 'past tense of',
    });
    expect(lookupWord('local', 'kuros', 'eo')?.lemmaInfo).toEqual({
      stem: 'kuri',
      label: 'future tense of',
    });
  });

  test('the kaikki inflections table wins before the rules', () => {
    expect(lookupWord('local', 'parolas', 'eo')?.lemmaInfo).toEqual({
      stem: 'paroli',
      label: 'present form of',
    });
  });

  test('derived adverbs resolve to their adjective source', () => {
    expect(lookupWord('local', 'sane', 'eo')?.lemmaInfo).toEqual({
      stem: 'sana',
      label: 'adverbial form of',
    });
  });

  test('productive compounds peel to a dictionary root (backtracking)', () => {
    // mal+san+ul+ej+o — greedy suffix peeling would eat -an out of malsan-;
    // the analyzer must backtrack and peel the mal- prefix instead.
    const entry = lookupWord('local', 'malsanulejo', 'eo');
    expect(entry?.lemmaInfo).toEqual({ stem: 'sano', label: 'mal- + -ul- + -ej- form of' });
    expect(entry?.ipa).toBe('/malsanuˈlejo/');
  });

  test('suffix derivations resolve across parts of speech', () => {
    expect(lookupWord('local', 'kurado', 'eo')?.lemmaInfo).toEqual({
      stem: 'kuri',
      label: '-ad- form of',
    });
  });

  test('root compounds resolve to their head', () => {
    expect(lookupWord('local', 'vaporŝipo', 'eo')?.lemmaInfo).toEqual({
      stem: 'ŝipo',
      label: 'compound ending in',
    });
  });

  test('x-system queries fold to the supersignoj (§3.4)', () => {
    expect(lookupWord('local', 'sxipo', 'eo')?.word).toBe('ŝipo');
    expect(lookupWord('local', 'cxu', 'eo')?.word).toBe('ĉu');
    // …and compose with the rules: sxipojn = ŝipojn → ŝipo.
    expect(lookupWord('local', 'sxipojn', 'eo')?.lemmaInfo).toEqual({
      stem: 'ŝipo',
      label: 'accusative plural of',
    });
  });

  test('words the rules cannot ground stay misses', () => {
    expect(lookupWord('local', 'la', 'eo')).toBeUndefined();
    expect(lookupWord('local', 'zzz', 'eo')).toBeUndefined();
    expect(lookupWord('local', 'xylophone', 'eo')).toBeUndefined();
  });
});
