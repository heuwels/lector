// Imported FIRST: refuses to run if DATA_DIR isn't an isolated .test-data dir,
// because the ratchet below opens the real singleton DB (see test-guard.ts).
import '../test-guard';
import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  adoptLocalData,
  countRowsByUser,
  hasAuthTables,
  listAuthUsers,
  resolveUserByEmail,
  AdoptConflictError,
  TENANT_TABLES,
} from './adopt-local-data';
import { LOCAL_USER_ID } from './user';
import { getDatabaseInstance } from '../db';

const TARGET = 'user-uuid-1';

/** Minimal-but-faithful tenant schema: same userId columns and PK shapes as the
 * real migrated DB (composite (userId, id); knownWords/dailyStats/settings with
 * userId in the PK; api_tokens id-only), plus Better Auth's `user` table. */
function createSchema(db: Database): void {
  db.exec(`
    CREATE TABLE collections      (id TEXT NOT NULL, userId TEXT NOT NULL DEFAULT 'local', PRIMARY KEY (userId, id));
    CREATE TABLE lessons          (id TEXT NOT NULL, userId TEXT NOT NULL DEFAULT 'local', PRIMARY KEY (userId, id));
    CREATE TABLE vocab            (id TEXT NOT NULL, userId TEXT NOT NULL DEFAULT 'local', PRIMARY KEY (userId, id));
    CREATE TABLE clozeSentences   (id TEXT NOT NULL, userId TEXT NOT NULL DEFAULT 'local', PRIMARY KEY (userId, id));
    CREATE TABLE journal_entries  (id TEXT NOT NULL, userId TEXT NOT NULL DEFAULT 'local', PRIMARY KEY (userId, id));
    CREATE TABLE chat_messages    (id TEXT NOT NULL, userId TEXT NOT NULL DEFAULT 'local', PRIMARY KEY (userId, id));
    CREATE TABLE collection_groups(id TEXT NOT NULL, userId TEXT NOT NULL DEFAULT 'local', PRIMARY KEY (userId, id));
    CREATE TABLE api_tokens       (id TEXT PRIMARY KEY, userId TEXT NOT NULL DEFAULT 'local');
    CREATE TABLE knownWords       (userId TEXT NOT NULL DEFAULT 'local', word TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'af', PRIMARY KEY (userId, word, language));
    CREATE TABLE dailyStats       (userId TEXT NOT NULL DEFAULT 'local', date TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'af', PRIMARY KEY (userId, date, language));
    CREATE TABLE settings         (userId TEXT NOT NULL DEFAULT 'local', key TEXT NOT NULL, value TEXT, PRIMARY KEY (userId, key));
    CREATE TABLE "user"           (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT);
  `);
}

/** Rows per table for the given user. chat_messages left empty on purpose, to
 * cover a tenant table with nothing to move. Total for 'local' = 28. */
function seedLocal(db: Database): void {
  const idRows: [string, number][] = [
    ['collections', 2],
    ['lessons', 3],
    ['vocab', 5],
    ['clozeSentences', 4],
    ['journal_entries', 1],
    ['chat_messages', 0],
    ['collection_groups', 1],
    ['api_tokens', 1],
  ];
  for (const [table, n] of idRows) {
    for (let i = 0; i < n; i++) {
      db.prepare(`INSERT INTO ${table} (id, userId) VALUES (?, ?)`).run(`${table}-${i}`, LOCAL_USER_ID);
    }
  }
  for (let i = 0; i < 6; i++) {
    db.prepare('INSERT INTO knownWords (userId, word, language) VALUES (?, ?, ?)').run(LOCAL_USER_ID, `w${i}`, 'af');
  }
  for (let i = 0; i < 2; i++) {
    db.prepare('INSERT INTO dailyStats (userId, date, language) VALUES (?, ?, ?)').run(LOCAL_USER_ID, `2026-01-0${i + 1}`, 'af');
  }
  for (let i = 0; i < 3; i++) {
    db.prepare('INSERT INTO settings (userId, key, value) VALUES (?, ?, ?)').run(LOCAL_USER_ID, `k${i}`, 'v');
  }
}

const LOCAL_TOTAL = 28;

describe('adoptLocalData', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
    seedLocal(db);
    db.prepare('INSERT INTO "user" (id, email, name) VALUES (?, ?, ?)').run(TARGET, 'Luke@Example.com', 'Luke');
  });

  test('resolves the target user by email, case-insensitively', () => {
    expect(hasAuthTables(db)).toBe(true);
    expect(resolveUserByEmail(db, 'luke@example.com')?.id).toBe(TARGET);
    expect(resolveUserByEmail(db, 'LUKE@EXAMPLE.COM')?.id).toBe(TARGET);
    expect(resolveUserByEmail(db, 'nobody@example.com')).toBeUndefined();
    expect(listAuthUsers(db).map((u) => u.email)).toEqual(['Luke@Example.com']);
  });

  test('dry run reports every local row but writes nothing', () => {
    const report = adoptLocalData(db, TARGET, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.totalMoved).toBe(LOCAL_TOTAL);
    expect(report.moved.vocab).toBe(5);
    expect(report.moved.knownWords).toBe(6);
    expect(report.moved.chat_messages).toBe(0);
    // Untouched: local still owns everything, target still owns nothing.
    expect(countRowsByUser(db, LOCAL_USER_ID).vocab).toBe(5);
    expect(countRowsByUser(db, TARGET).vocab).toBe(0);
  });

  test('commit reassigns all local rows to the target', () => {
    const report = adoptLocalData(db, TARGET);
    expect(report.dryRun).toBe(false);
    expect(report.totalMoved).toBe(LOCAL_TOTAL);

    const local = countRowsByUser(db, LOCAL_USER_ID);
    expect(Object.values(local).every((n) => n === 0)).toBe(true);

    const target = countRowsByUser(db, TARGET);
    expect(target.vocab).toBe(5);
    expect(target.knownWords).toBe(6);
    expect(target.settings).toBe(3);
    expect(Object.values(target).reduce((a, b) => a + b, 0)).toBe(LOCAL_TOTAL);
  });

  test('is idempotent — a second run moves nothing', () => {
    adoptLocalData(db, TARGET);
    const second = adoptLocalData(db, TARGET);
    expect(second.totalMoved).toBe(0);
  });

  test('refuses (and rolls back) when the target account is not empty', () => {
    // A pre-existing row owned by the target: adoption must not merge into it.
    db.prepare('INSERT INTO vocab (id, userId) VALUES (?, ?)').run('pre-existing', TARGET);

    let caught: unknown;
    try {
      adoptLocalData(db, TARGET);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AdoptConflictError);
    expect((caught as AdoptConflictError).conflicts.vocab).toBe(1);

    // Rolled back: local data intact, target unchanged (still just its own row).
    expect(countRowsByUser(db, LOCAL_USER_ID).vocab).toBe(5);
    expect(countRowsByUser(db, TARGET).vocab).toBe(1);
  });

  test('rejects an invalid target (empty or the local sentinel)', () => {
    expect(() => adoptLocalData(db, '')).toThrow();
    expect(() => adoptLocalData(db, LOCAL_USER_ID)).toThrow();
  });
});

describe('TENANT_TABLES ratchet', () => {
  // Tables that carry a userId column but are deliberately NOT tenant learning
  // data, so adoption skips them:
  //   - session / account: Better Auth internals (userId is an FK to the user).
  //   - billing_subscriptions: Paddle-managed cloud state whose (nullable)
  //     userId links a subscription to an account and is set by webhook
  //     matching — never 'local', so there is nothing for adoption to move.
  //   - admin_account_flags: operator-set support state (#221) keyed by the
  //     account userId; a migrating self-hoster's 'local' user has none, and
  //     suspension must not travel with adopted data.
  // Subtracted here so the assertion stays meaningful even on a DB that has
  // them (a fresh getDb() schema omits Better Auth's, but not billing's).
  const NON_TENANT_USERID_TABLES = new Set([
    'session',
    'account',
    'billing_subscriptions',
    'admin_account_flags',
  ]);

  test('every table with a userId column is covered by adoption', () => {
    const db = getDatabaseInstance(); // real, fully-migrated schema (.test-data)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];

    const withUserId = tables
      .map((t) => t.name)
      .filter((name) => !NON_TENANT_USERID_TABLES.has(name))
      .filter((name) =>
        (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).some(
          (c) => c.name === 'userId',
        ),
      )
      .sort();

    expect(withUserId).toEqual([...TENANT_TABLES].sort());
  });
});
