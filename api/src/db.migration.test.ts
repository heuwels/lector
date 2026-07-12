import './test-guard';
import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import { migrateAcceptedCacheUserKey, migrateCompositeTenantKeys } from './db';

// #279 — the composite (userId, id) rebuild, exercised against a synthetic
// PRE-migration database (not the singleton `db`, which is already migrated).
// The old shape is reproduced faithfully: `id TEXT PRIMARY KEY`, the legacy
// FK declarations, and `language`/`userId` appended LAST (the ALTER order on
// a real aged DB) — so the explicit column-list copy is proven against a
// column order that differs from the rebuilt tables'.

const DB_FILE = path.join(process.env.DATA_DIR!, 'composite-pk-migration.db');

const TS = '2026-01-01T00:00:00Z';

const TABLES = [
  'collection_groups',
  'collections',
  'lessons',
  'vocab',
  'clozeSentences',
  'chat_messages',
  'journal_entries',
];

function createOldSchema(db: Database) {
  db.exec(`
    CREATE TABLE collection_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      userId TEXT NOT NULL DEFAULT 'local'
    );

    CREATE TABLE collections (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT 'Unknown',
      coverUrl TEXT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      lastReadAt TEXT NOT NULL,
      groupId TEXT REFERENCES collection_groups(id) ON DELETE SET NULL,
      language TEXT NOT NULL DEFAULT 'af',
      userId TEXT NOT NULL DEFAULT 'local'
    );

    CREATE TABLE lessons (
      id TEXT PRIMARY KEY,
      collectionId TEXT,
      title TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      textContent TEXT NOT NULL DEFAULT '',
      progress_scrollPosition INTEGER DEFAULT 0,
      progress_percentComplete REAL DEFAULT 0,
      wordCount INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL,
      lastReadAt TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'af',
      userId TEXT NOT NULL DEFAULT 'local',
      FOREIGN KEY (collectionId) REFERENCES collections(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_lessons_collectionId ON lessons(collectionId);
    CREATE INDEX idx_lessons_sortOrder ON lessons(collectionId, sortOrder);

    CREATE TABLE vocab (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('word', 'phrase')),
      sentence TEXT NOT NULL,
      translation TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('new', 'level1', 'level2', 'level3', 'level4', 'known', 'ignored')),
      stateUpdatedAt TEXT NOT NULL,
      reviewCount INTEGER DEFAULT 0,
      bookId TEXT,
      chapter INTEGER,
      createdAt TEXT NOT NULL,
      pushedToAnki INTEGER DEFAULT 0,
      ankiNoteId INTEGER,
      language TEXT NOT NULL DEFAULT 'af',
      userId TEXT NOT NULL DEFAULT 'local'
    );
    CREATE INDEX idx_vocab_text ON vocab(text);
    CREATE INDEX idx_vocab_state ON vocab(state);
    CREATE INDEX idx_vocab_bookId ON vocab(bookId);

    CREATE TABLE clozeSentences (
      id TEXT PRIMARY KEY,
      sentence TEXT NOT NULL,
      clozeWord TEXT NOT NULL,
      clozeIndex INTEGER NOT NULL,
      translation TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('tatoeba', 'mined')),
      collection TEXT NOT NULL CHECK (collection IN ('top500', 'top1000', 'top2000', 'mined', 'random')),
      wordRank INTEGER,
      tatoebaSentenceId INTEGER,
      vocabEntryId TEXT,
      masteryLevel INTEGER DEFAULT 0 CHECK (masteryLevel IN (0, 25, 50, 75, 100)),
      nextReview TEXT NOT NULL,
      reviewCount INTEGER DEFAULT 0,
      lastReviewed TEXT,
      timesCorrect INTEGER DEFAULT 0,
      timesIncorrect INTEGER DEFAULT 0,
      blacklisted INTEGER DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'af',
      userId TEXT NOT NULL DEFAULT 'local',
      FOREIGN KEY (vocabEntryId) REFERENCES vocab(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_cloze_collection ON clozeSentences(collection);
    CREATE INDEX idx_cloze_nextReview ON clozeSentences(nextReview);
    CREATE INDEX idx_cloze_clozeWord ON clozeSentences(clozeWord);
    CREATE INDEX idx_cloze_masteryLevel ON clozeSentences(masteryLevel);

    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      provider TEXT,
      responseId TEXT,
      createdAt TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'af',
      userId TEXT NOT NULL DEFAULT 'local'
    );
    CREATE INDEX idx_chat_messages_createdAt ON chat_messages(createdAt);

    CREATE TABLE journal_entries (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL DEFAULT '',
      correctedBody TEXT,
      corrections TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
      wordCount INTEGER DEFAULT 0,
      entryDate TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'af',
      userId TEXT NOT NULL DEFAULT 'local',
      UNIQUE(entryDate)
    );
    CREATE INDEX idx_journal_status ON journal_entries(status);
  `);
}

function seed(db: Database) {
  db.exec(`
    INSERT INTO collection_groups (id, name, sortOrder, createdAt, userId)
      VALUES ('g1', 'Klassieke', 2, '${TS}', 'local'),
             ('g2', 'Ander', 0, '${TS}', 'other-user');

    INSERT INTO collections (id, title, author, coverUrl, sortOrder, createdAt, lastReadAt, groupId, language, userId)
      VALUES ('col1', 'Die Boek', 'Skrywer', NULL, 3, '${TS}', '${TS}', 'g1', 'af', 'local'),
             ('col2', 'Das Buch', 'Autor', 'http://x/c.png', 0, '${TS}', '${TS}', NULL, 'de', 'other-user');

    INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, progress_scrollPosition, progress_percentComplete, wordCount, createdAt, lastReadAt, language, userId)
      VALUES ('les1', 'col1', 'Hoofstuk Een', 1, 'Die kat sit.', 120, 45.5, 3, '${TS}', '${TS}', 'af', 'local'),
             ('les2', 'col2', 'Kapitel Eins', 0, 'Die Katze sitzt.', 0, 0, 3, '${TS}', '${TS}', 'de', 'other-user');

    INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, reviewCount, bookId, chapter, createdAt, pushedToAnki, ankiNoteId, language, userId)
      VALUES ('v1', 'kat', 'word', 'Die kat sit.', 'cat', 'level2', '${TS}', 4, 'col1', 2, '${TS}', 1, 987, 'af', 'local'),
             ('v2', 'Katze', 'word', 'Die Katze sitzt.', 'cat', 'new', '${TS}', 0, NULL, NULL, '${TS}', 0, NULL, 'de', 'other-user');

    INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, vocabEntryId, masteryLevel, nextReview, reviewCount, lastReviewed, timesCorrect, timesIncorrect, blacklisted, language, userId)
      VALUES ('c1', 'Die ___ sit.', 'kat', 1, 'The cat sits.', 'mined', 'mined', 12, NULL, 'v1', 50, '${TS}', 7, '${TS}', 6, 1, 0, 'af', 'local'),
             ('c2', 'Die ___ sitzt.', 'Katze', 1, 'The cat sits.', 'tatoeba', 'top500', 8, 4242, NULL, 0, '${TS}', 0, NULL, 0, 0, 1, 'de', 'other-user');

    INSERT INTO chat_messages (id, role, content, provider, responseId, createdAt, language, userId)
      VALUES ('m1', 'user', 'Verduidelik', 'anthropic', 'resp_1', '${TS}', 'af', 'local'),
             ('m2', 'assistant', 'Antwort', NULL, NULL, '${TS}', 'de', 'other-user');

    INSERT INTO journal_entries (id, body, correctedBody, corrections, status, wordCount, entryDate, createdAt, updatedAt, language, userId)
      VALUES ('j1', 'my dagboek', 'my dagboek.', '[]', 'submitted', 2, '2026-01-01', '${TS}', '${TS}', 'af', 'local'),
             ('j2', 'mein Tagebuch', NULL, NULL, 'draft', 2, '2026-01-02', '${TS}', '${TS}', 'de', 'other-user');
  `);
}

function pkOf(db: Database, table: string): string[] {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; pk: number }[];
  return cols
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
}

function dumpAll(db: Database): Record<string, unknown[]> {
  const dump: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    dump[t] = db.prepare(`SELECT * FROM ${t} ORDER BY userId, id`).all();
  }
  return dump;
}

let db: Database;

beforeEach(() => {
  // This file can run before anything touches the singleton db (which is what
  // normally mkdirs DATA_DIR), so create the isolated dir ourselves.
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  fs.rmSync(DB_FILE, { force: true });
  db = new Database(DB_FILE);
  createOldSchema(db);
  seed(db);
});

describe('migrateCompositeTenantKeys (#279)', () => {
  test('rebuilds every synthetic-id tenant table onto PRIMARY KEY (userId, id)', () => {
    for (const t of TABLES) expect(pkOf(db, t), `${t} pre-migration`).toEqual(['id']);

    migrateCompositeTenantKeys(db);

    for (const t of TABLES) expect(pkOf(db, t), `${t} post-migration`).toEqual(['userId', 'id']);
  });

  test('preserves every row and every column value across the rebuild', () => {
    // The dump is column-name keyed, so it survives the (deliberate) column
    // reorder; deep-equality proves no value was lost, nulled, or defaulted.
    const before = dumpAll(db);
    migrateCompositeTenantKeys(db);
    const after = dumpAll(db);

    expect(after).toEqual(before);
    // Spot-check the fullest row end-to-end anyway (belt and braces).
    const v1 = db.prepare("SELECT * FROM vocab WHERE id = 'v1'").get() as Record<string, unknown>;
    expect(v1).toMatchObject({
      userId: 'local',
      id: 'v1',
      text: 'kat',
      type: 'word',
      sentence: 'Die kat sit.',
      translation: 'cat',
      state: 'level2',
      stateUpdatedAt: TS,
      reviewCount: 4,
      bookId: 'col1',
      chapter: 2,
      language: 'af',
      createdAt: TS,
      pushedToAnki: 1,
      ankiNoteId: 987,
    });
  });

  test('recreates the legacy per-table indexes the rebuild drops', () => {
    migrateCompositeTenantKeys(db);
    const indexes = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .all() as { name: string }[]
    ).map((r) => r.name);
    for (const expected of [
      'idx_lessons_collectionId',
      'idx_lessons_sortOrder',
      'idx_vocab_text',
      'idx_vocab_state',
      'idx_vocab_bookId',
      'idx_cloze_collection',
      'idx_cloze_nextReview',
      'idx_cloze_clozeWord',
      'idx_cloze_masteryLevel',
      'idx_chat_messages_createdAt',
      'idx_journal_status',
    ]) {
      expect(indexes, `${expected} must be recreated`).toContain(expected);
    }
  });

  test('is idempotent — a second run leaves schema and data untouched', () => {
    migrateCompositeTenantKeys(db);
    const first = dumpAll(db);
    const firstSchemas = TABLES.map(
      (t) =>
        (
          db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(t) as {
            sql: string;
          }
        ).sql,
    );

    migrateCompositeTenantKeys(db);

    expect(dumpAll(db)).toEqual(first);
    const secondSchemas = TABLES.map(
      (t) =>
        (
          db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(t) as {
            sql: string;
          }
        ).sql,
    );
    expect(secondSchemas).toEqual(firstSchemas);
  });

  test('kills the overwrite class at the schema level: INSERT OR REPLACE with a foreign id cannot clobber', () => {
    migrateCompositeTenantKeys(db);

    // The exact attack #220 patched around: an unguarded INSERT OR REPLACE
    // carrying another tenant's row id. Post-#279 it must land as the
    // writer's own row, with the victim's row byte-identical.
    db.prepare(
      `INSERT OR REPLACE INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, createdAt, language, userId)
       VALUES ('v2', 'hijack', 'word', 'x', 'x', 'new', ?, ?, 'de', 'local')`,
    ).run(TS, TS);

    const victim = db
      .prepare("SELECT text, translation FROM vocab WHERE id = 'v2' AND userId = 'other-user'")
      .get() as { text: string };
    expect(victim.text).toBe('Katze');
    const attacker = db
      .prepare("SELECT text FROM vocab WHERE id = 'v2' AND userId = 'local'")
      .get() as { text: string };
    expect(attacker.text).toBe('hijack');

    // Same-tenant REPLACE still works as an upsert (the legitimate use).
    db.prepare(
      `INSERT OR REPLACE INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, createdAt, language, userId)
       VALUES ('v2', 'hijack2', 'word', 'x', 'x', 'new', ?, ?, 'de', 'local')`,
    ).run(TS, TS);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM vocab WHERE id = 'v2'").get() as {
      n: number;
    };
    expect(rows.n).toBe(2); // still one per tenant
  });

  test('drops the journal UNIQUE(entryDate) leftover if the legacy index-drop migration never ran', () => {
    // The synthetic old schema carries the ancient UNIQUE(entryDate) table
    // constraint; the rebuild must not carry it forward (multiple entries per
    // day are allowed since the idx_journal_entryDate fix).
    migrateCompositeTenantKeys(db);
    db.prepare(
      `INSERT INTO journal_entries (id, body, status, wordCount, entryDate, createdAt, updatedAt, language, userId)
       VALUES ('j3', 'tweede inskrywing', 'draft', 2, '2026-01-01', ?, ?, 'af', 'local')`,
    ).run(TS, TS);
    const n = (
      db
        .prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE entryDate = '2026-01-01'")
        .get() as { n: number }
    ).n;
    expect(n).toBe(2);
  });
});

describe('migrateAcceptedCacheUserKey', () => {
  test('boots and migrates a pre-tenant cache database before creating userId indexes', () => {
    const legacyDataDir = path.join(process.env.DATA_DIR!, 'legacy-cache-boot');
    const legacyDbFile = path.join(legacyDataDir, 'lector.db');
    fs.rmSync(legacyDataDir, { recursive: true, force: true });
    fs.mkdirSync(legacyDataDir, { recursive: true });

    const legacyDb = new Database(legacyDbFile);
    legacyDb.exec(`
      CREATE TABLE cached_entries (
        word TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'af',
        ipa TEXT,
        etymology TEXT,
        sourceSentence TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (word, language)
      );
      CREATE TABLE cached_senses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'af',
        pos TEXT,
        gloss TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE cached_related_forms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'af',
        related_word TEXT NOT NULL,
        relation TEXT NOT NULL
      );
      INSERT INTO cached_entries
        (word, language, createdAt, updatedAt)
        VALUES ('skaars', 'af', '${TS}', '${TS}');
    `);
    legacyDb.close();

    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        '-e',
        "import { getDatabaseInstance } from './src/db.ts'; getDatabaseInstance().close();",
      ],
      cwd: path.resolve(import.meta.dir, '..'),
      env: { ...process.env, DATA_DIR: legacyDataDir },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stderr = new TextDecoder().decode(result.stderr);
    expect(result.exitCode, stderr).toBe(0);

    const migratedDb = new Database(legacyDbFile);
    expect(pkOf(migratedDb, 'cached_entries')).toEqual(['userId', 'word', 'language']);
    expect(
      migratedDb.prepare("SELECT userId FROM cached_entries WHERE word = 'skaars'").get(),
    ).toEqual({ userId: 'local' });
    const indexes = (
      migratedDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_cached_%'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain('idx_cached_entries_user_language');
    expect(indexes).toContain('idx_cached_senses_user_word');
    expect(indexes).toContain('idx_cached_related_user_word');
    migratedDb.close();
  });

  test('moves legacy compound cache rows to local and permits one row per tenant', () => {
    const cacheDb = new Database(':memory:');
    cacheDb.exec(`
      CREATE TABLE cached_entries (
        word TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'af',
        ipa TEXT,
        etymology TEXT,
        sourceSentence TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (word, language)
      );
      CREATE TABLE cached_senses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'af',
        pos TEXT,
        gloss TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE cached_related_forms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'af',
        related_word TEXT NOT NULL,
        relation TEXT NOT NULL
      );
      INSERT INTO cached_entries
        (word, language, ipa, etymology, sourceSentence, createdAt, updatedAt)
        VALUES ('skaars', 'af', '/skɑːrs/', 'origin', 'private source', '${TS}', '${TS}');
      INSERT INTO cached_senses (id, word, language, pos, gloss, sort_order)
        VALUES (7, 'skaars', 'af', 'adjective', 'scarce', 0);
      INSERT INTO cached_related_forms (id, word, language, related_word, relation)
        VALUES (9, 'skaars', 'af', 'skaarste', 'superlative');
    `);

    migrateAcceptedCacheUserKey(cacheDb);

    expect(pkOf(cacheDb, 'cached_entries')).toEqual(['userId', 'word', 'language']);
    expect(
      cacheDb
        .prepare('SELECT userId, sourceSentence FROM cached_entries WHERE word = ?')
        .get('skaars'),
    ).toEqual({ userId: 'local', sourceSentence: 'private source' });
    expect(
      cacheDb.prepare('SELECT id, userId, gloss FROM cached_senses WHERE word = ?').get('skaars'),
    ).toEqual({ id: 7, userId: 'local', gloss: 'scarce' });
    expect(
      cacheDb
        .prepare('SELECT id, userId, related_word FROM cached_related_forms WHERE word = ?')
        .get('skaars'),
    ).toEqual({ id: 9, userId: 'local', related_word: 'skaarste' });

    cacheDb
      .prepare(
        `INSERT INTO cached_entries
          (userId, word, language, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('alice', 'skaars', 'af', TS, TS);
    expect(
      (
        cacheDb
          .prepare('SELECT COUNT(*) AS n FROM cached_entries WHERE word = ? AND language = ?')
          .get('skaars', 'af') as { n: number }
      ).n,
    ).toBe(2);

    const before = cacheDb.prepare('SELECT * FROM cached_entries ORDER BY userId').all();
    migrateAcceptedCacheUserKey(cacheDb);
    expect(cacheDb.prepare('SELECT * FROM cached_entries ORDER BY userId').all()).toEqual(before);
  });
});
