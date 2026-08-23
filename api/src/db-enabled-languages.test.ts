import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrateEnabledLanguages } from './db';

// The #442 backfill. An account that predates the opt-in picker must keep every
// language it already studies, not just its target language.

interface Seed {
  settings?: Array<{ userId: string; key: string; value: unknown }>;
  rows?: Partial<Record<string, Array<{ userId: string; language: string | null }>>>;
}

const LANGUAGE_TABLES = ['collections', 'lessons', 'vocab', 'knownWords', 'dailyStats'];

function freshDb(seed: Seed = {}): Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (userId TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (userId, key));
  `);
  for (const table of LANGUAGE_TABLES) {
    db.exec(`CREATE TABLE ${table} (userId TEXT NOT NULL, language TEXT)`);
  }

  const setting = db.prepare('INSERT INTO settings (userId, key, value) VALUES (?, ?, ?)');
  for (const row of seed.settings ?? [])
    setting.run(row.userId, row.key, JSON.stringify(row.value));

  for (const [table, rows] of Object.entries(seed.rows ?? {})) {
    const insert = db.prepare(`INSERT INTO ${table} (userId, language) VALUES (?, ?)`);
    for (const row of rows ?? []) insert.run(row.userId, row.language);
  }
  return db;
}

function enabled(db: Database, userId: string): unknown {
  const row = db
    .prepare("SELECT value FROM settings WHERE userId = ? AND key = 'enabledLanguages'")
    .get(userId) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : null;
}

describe('migrateEnabledLanguages', () => {
  test('backfills the target language plus every language the rows carry', () => {
    const db = freshDb({
      settings: [{ userId: 'local', key: 'targetLanguage', value: 'de' }],
      rows: {
        knownWords: [
          { userId: 'local', language: 'af' },
          { userId: 'local', language: 'af' },
        ],
        vocab: [{ userId: 'local', language: 'zh' }],
      },
    });
    migrateEnabledLanguages(db);
    expect(enabled(db, 'local')).toEqual(['af', 'de', 'zh']);
  });

  test('an account with no rows gets its target language alone', () => {
    const db = freshDb({ settings: [{ userId: 'local', key: 'targetLanguage', value: 'af' }] });
    migrateEnabledLanguages(db);
    expect(enabled(db, 'local')).toEqual(['af']);
  });

  test('leaves an account that already chose its languages alone', () => {
    const db = freshDb({
      settings: [
        { userId: 'local', key: 'targetLanguage', value: 'af' },
        { userId: 'local', key: 'enabledLanguages', value: ['af'] },
      ],
      rows: { vocab: [{ userId: 'local', language: 'de' }] },
    });
    migrateEnabledLanguages(db);
    expect(enabled(db, 'local')).toEqual(['af']);
  });

  test('skips an account that has not finished setup', () => {
    const db = freshDb({ settings: [{ userId: 'u1', key: 'timezone', value: 'UTC' }] });
    migrateEnabledLanguages(db);
    expect(enabled(db, 'u1')).toBeNull();
  });

  test('keeps accounts apart', () => {
    const db = freshDb({
      settings: [
        { userId: 'u1', key: 'targetLanguage', value: 'af' },
        { userId: 'u2', key: 'targetLanguage', value: 'fr' },
      ],
      rows: {
        vocab: [
          { userId: 'u1', language: 'de' },
          { userId: 'u2', language: 'zh' },
        ],
      },
    });
    migrateEnabledLanguages(db);
    expect(enabled(db, 'u1')).toEqual(['af', 'de']);
    expect(enabled(db, 'u2')).toEqual(['fr', 'zh']);
  });

  test('drops a language code that no pack matches', () => {
    const db = freshDb({
      settings: [{ userId: 'local', key: 'targetLanguage', value: 'af' }],
      rows: {
        vocab: [
          { userId: 'local', language: 'xx' },
          { userId: 'local', language: null },
        ],
      },
    });
    migrateEnabledLanguages(db);
    expect(enabled(db, 'local')).toEqual(['af']);
  });

  test('reads a target language that was stored unquoted', () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO settings (userId, key, value) VALUES ('local', 'targetLanguage', 'de')",
    ).run();
    migrateEnabledLanguages(db);
    expect(enabled(db, 'local')).toEqual(['de']);
  });

  test('is a no-op on a second run', () => {
    const db = freshDb({ settings: [{ userId: 'local', key: 'targetLanguage', value: 'af' }] });
    migrateEnabledLanguages(db);
    db.prepare(
      "UPDATE settings SET value = ? WHERE userId = 'local' AND key = 'enabledLanguages'",
    ).run(JSON.stringify(['af', 'de']));
    migrateEnabledLanguages(db);
    expect(enabled(db, 'local')).toEqual(['af', 'de']);
  });

  test('tolerates a database with none of the language tables', () => {
    const db = new Database(':memory:');
    db.exec(
      'CREATE TABLE settings (userId TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (userId, key))',
    );
    db.prepare(
      "INSERT INTO settings (userId, key, value) VALUES ('local', 'targetLanguage', '\"af\"')",
    ).run();
    migrateEnabledLanguages(db);
    expect(enabled(db, 'local')).toEqual(['af']);
  });
});
