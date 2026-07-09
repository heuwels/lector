import './test-guard';
import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import { migrateFoldWordKeys } from './db';

// #289 Phase 0, item 0.9 — re-keying stored words through foldWord.
// Exercised against a synthetic post-schema database (the migration runs
// last in getDb, so it can assume the current table shapes).

const DB_FILE = path.join(process.env.DATA_DIR!, 'fold-keys-migration.db');

const COMBINING_CIRCUMFLEX = String.fromCharCode(0x0302);
const SOFT_HYPHEN = String.fromCharCode(0x00ad);

function createSchema(db: Database) {
  db.exec(`
    CREATE TABLE knownWords (
      userId TEXT NOT NULL DEFAULT 'local',
      word TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'af',
      state TEXT NOT NULL,
      domain TEXT,
      PRIMARY KEY (userId, word, language)
    );

    CREATE TABLE vocab (
      userId TEXT NOT NULL DEFAULT 'local',
      id TEXT NOT NULL,
      text TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'af',
      PRIMARY KEY (userId, id)
    );
  `);
}

let db: Database;

beforeEach(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  fs.rmSync(DB_FILE, { force: true });
  db = new Database(DB_FILE);
  createSchema(db);
});

const known = (word: string, state = 'known', userId = 'local', language = 'af', domain: string | null = null) =>
  db
    .prepare('INSERT INTO knownWords (userId, word, language, state, domain) VALUES (?, ?, ?, ?, ?)')
    .run(userId, word, language, state, domain);

const allKnown = () =>
  db.prepare('SELECT userId, word, language, state, domain FROM knownWords ORDER BY word').all() as Array<{
    userId: string;
    word: string;
    language: string;
    state: string;
    domain: string | null;
  }>;

describe('migrateFoldWordKeys (#289 0.9)', () => {
  test('is a no-op on already-folded data', () => {
    known('huis');
    known('môre', 'level2');
    migrateFoldWordKeys(db);
    expect(allKnown().map((r) => r.word)).toEqual(['huis', 'môre']);
  });

  test('re-keys decomposed words to NFC', () => {
    const decomposed = 'se' + COMBINING_CIRCUMFLEX;
    known(decomposed, 'level3');
    migrateFoldWordKeys(db);
    const rows = allKnown();
    expect(rows).toHaveLength(1);
    expect(rows[0].word).toBe('sê');
    expect(rows[0].state).toBe('level3');
  });

  test('strips soft hyphens from keys', () => {
    known('hu' + SOFT_HYPHEN + 'is', 'level1');
    migrateFoldWordKeys(db);
    expect(allKnown()[0].word).toBe('huis');
  });

  test('merges onto an existing folded row, keeping the strongest state', () => {
    const decomposed = 'se' + COMBINING_CIRCUMFLEX;
    known('sê', 'level1', 'local', 'af', 'nature');
    known(decomposed, 'known');
    migrateFoldWordKeys(db);
    const rows = allKnown();
    expect(rows).toHaveLength(1);
    expect(rows[0].word).toBe('sê');
    expect(rows[0].state).toBe('known'); // known beats level1
    expect(rows[0].domain).toBe('nature'); // classified domain survives
  });

  test('merges two unnormalized variants that collide after folding', () => {
    const a = 'se' + COMBINING_CIRCUMFLEX; // NFC → sê
    const b = 's' + SOFT_HYPHEN + 'ê'; // strip → sê
    known(a, 'level2');
    known(b, 'ignored');
    migrateFoldWordKeys(db);
    const rows = allKnown();
    expect(rows).toHaveLength(1);
    expect(rows[0].word).toBe('sê');
    expect(rows[0].state).toBe('ignored'); // deliberate signal wins
  });

  test('scopes re-keying by user and language', () => {
    const decomposed = 'se' + COMBINING_CIRCUMFLEX;
    known(decomposed, 'known', 'user-a', 'af');
    known(decomposed, 'level1', 'user-b', 'af');
    known('sê', 'level4', 'user-a', 'nl');
    migrateFoldWordKeys(db);
    const rows = allKnown();
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.userId === 'user-a' && r.language === 'af')[0].state).toBe('known');
    expect(rows.filter((r) => r.userId === 'user-b')[0].state).toBe('level1');
  });

  test('NFC-normalizes vocab display text in place without deduping', () => {
    const decomposed = 'se' + COMBINING_CIRCUMFLEX;
    db.prepare('INSERT INTO vocab (userId, id, text) VALUES (?, ?, ?)').run('local', 'v1', decomposed);
    db.prepare('INSERT INTO vocab (userId, id, text) VALUES (?, ?, ?)').run('local', 'v2', 'sê');
    migrateFoldWordKeys(db);
    const rows = db.prepare('SELECT id, text FROM vocab ORDER BY id').all() as Array<{ id: string; text: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toBe('sê');
    expect(rows[1].text).toBe('sê');
  });

  test('is idempotent across repeated boots', () => {
    const decomposed = 'se' + COMBINING_CIRCUMFLEX;
    known(decomposed, 'level2');
    migrateFoldWordKeys(db);
    const after = allKnown();
    migrateFoldWordKeys(db);
    expect(allKnown()).toEqual(after);
  });
});
