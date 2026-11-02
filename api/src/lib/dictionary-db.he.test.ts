import '../test-guard';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { invalidateDictionaryCache, lookupWord } from './dictionary-db';

// Modern Hebrew lookup. Keys are unpointed with final forms kept. The loose
// final-form fallback runs after the exact steps, and the prefix peel runs last.

const FIXTURE_DIR = path.resolve('.test-data', 'dict-he-fixture');
const previousDictDir = process.env.DICT_DIR;
const USER = 'he-fixture-user';

beforeAll(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const db = new Database(path.join(FIXTURE_DIR, 'dictionary-he.db'));
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

  const words: Array<[string, string, string, string]> = [
    ['כלב', 'noun', 'dog', 'כֶּלֶב kélev · כָּלֵב kalév'],
    ['שולחן', 'noun', 'table', 'שֻׁלְחָן shulkhán'],
    ['בית', 'noun', 'house', 'בַּיִת báyit'],
    ['אני', 'pron', 'I', 'אֲנִי aní'],
    ['ספר', 'noun', 'book', 'סֵפֶר séfer'],
    ['צה״ל', 'name', 'the Israel Defense Forces', 'tsáhal'],
    ['ג׳ירפה', 'noun', 'giraffe', 'גִ׳ירָפָה jiráfa'],
    ['לחן', 'noun', 'tune', 'לַחַן lákhan'],
  ];
  for (const [word, pos, gloss, ipa] of words) {
    entry.run(word, 10, ipa);
    sense.run(word, pos, gloss);
  }

  infl.run('כלבים', 'כלב', 'indefinite,plural');
  infl.run('שלחן', 'שולחן', 'defective');
  infl.run('לחנו', 'לחן', 'possessed-form');
  // The alias rows the build registers for the loose fold (type 'unpointed').
  infl.run('שולחנ', 'שולחן', 'unpointed');
  db.close();
  process.env.DICT_DIR = FIXTURE_DIR;
  invalidateDictionaryCache('he');
});

afterAll(() => {
  if (previousDictDir === undefined) delete process.env.DICT_DIR;
  else process.env.DICT_DIR = previousDictDir;
  invalidateDictionaryCache('he');
});

function resolved(word: string) {
  const entry = lookupWord(USER, word, 'he');
  return {
    stem: entry?.lemmaInfo?.stem ?? entry?.word,
    gloss: entry?.senses?.[0]?.gloss,
    label: entry?.lemmaInfo?.label,
    ipa: entry?.ipa ?? undefined,
  };
}

describe('Hebrew key folding', () => {
  test('a pointed word hits the unpointed key', () => {
    expect(resolved('כֶּלֶב').stem).toBe('כלב');
    expect(resolved('שֻׁלְחָן').stem).toBe('שולחן');
  });

  test('ASCII quote marks reach a geresh or gershayim key', () => {
    expect(resolved('צה"ל').stem).toBe('צה״ל');
    expect(resolved("ג'ירפה").stem).toBe('ג׳ירפה');
  });

  test('the lookup answers every pointed reading and its transliteration', () => {
    expect(resolved('כלב').ipa).toBe('כֶּלֶב kélev · כָּלֵב kalév');
  });

  test('a defective spelling resolves to the full spelling', () => {
    const hit = resolved('שלחן');
    expect(hit.stem).toBe('שולחן');
    expect(hit.label).toBe('defective form of');
  });
});

describe('Hebrew final-form fallback (step 3-he)', () => {
  test('a medial letter at the end reaches the final-form key', () => {
    const hit = resolved('שולחנ');
    expect(hit.stem).toBe('שולחן');
    expect(hit.gloss).toBe('table');
  });
});

describe('Hebrew prefixes (step 5-morph)', () => {
  test('peels the article', () => {
    const hit = resolved('הבית');
    expect(hit.stem).toBe('בית');
    expect(hit.label).toBe('ה form of');
  });

  test('peels a stack of prefixes onto an inflected form', () => {
    const hit = resolved('והכלבים');
    expect(hit.stem).toBe('כלב');
  });

  test('tries the prefix before a suffix', () => {
    expect(resolved('שאני').stem).toBe('אני');
  });

  test('peels one possessive suffix before a stack of two prefixes', () => {
    // ש + ו + לחנו reaches לחן "tune" and takes two peels.
    expect(resolved('שולחנו').stem).toBe('שולחן');
  });

  test('an exact headword is never taken apart', () => {
    const hit = resolved('ספר');
    expect(hit.stem).toBe('ספר');
    expect(hit.label).toBeUndefined();
  });
});
