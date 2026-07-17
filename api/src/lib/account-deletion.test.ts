import '../test-guard';
import { describe, test, expect, beforeEach } from 'bun:test';
import { db, getDatabaseInstance } from '../db';
import { ERASURE_TABLES, purgeTenantData } from './account-deletion';

/**
 * Right-to-erasure (#227): purgeTenantData must wipe EVERY userId-scoped table
 * for one tenant — learning data, BYOK credentials, per-user AI-translation
 * caches, the operator flag, the Paddle mirror — and leave every other tenant
 * untouched. A completeness ratchet (bottom) guarantees no future userId table
 * escapes. Runs against the isolated .test-data DB (test-guard refuses anything
 * else).
 */

const USER_A = 'user-aaa';
const USER_B = 'user-bbb';
const EMAIL_A = 'a@erasure.test';
const EMAIL_B = 'b@erasure.test';
const CUSTOMER_A = 'ctm_aaa';
const CUSTOMER_B = 'ctm_bbb';
const NOW = '2026-07-14T00:00:00Z';

// The tables `seed()` populates — a representative row per userId-carrying app
// table, including the ones an earlier hand-rolled list missed (BYOK creds,
// caches, learner data, admin flag). twoFactor is Better Auth's and absent from
// the getDb schema, so it's covered by the ratchet + the runtime guard instead.
const SEEDED_TABLES = [
  'collections',
  'lessons',
  'collection_groups',
  'vocab',
  'clozeSentences',
  'knownWords',
  'dailyStats',
  'journal_entries',
  'chat_messages',
  'settings',
  'api_tokens',
  'learner_profiles',
  'onboarding_progress',
  'learner_events',
  'usage_counters',
  'user_provider_credentials',
  'cached_entries',
  'anki_pending',
  'admin_account_flags',
  'billing_subscriptions',
] as const;

function clearAll() {
  for (const t of SEEDED_TABLES) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare('DELETE FROM billing_customers').run();
}

function rowsFor(table: string, userId: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE userId = ?`).get(userId) as { c: number }
  ).c;
}

/** One row in every seeded tenant table (+ the Paddle mirror pair) for `userId`. */
function seed(userId: string, email: string, customerId: string) {
  db.prepare(
    'INSERT INTO collections (userId, id, title, createdAt, lastReadAt) VALUES (?,?,?,?,?)',
  ).run(userId, `col-${userId}`, 'A book', NOW, NOW);
  db.prepare(
    'INSERT INTO lessons (userId, id, title, createdAt, lastReadAt) VALUES (?,?,?,?,?)',
  ).run(userId, `les-${userId}`, 'A lesson', NOW, NOW);
  db.prepare('INSERT INTO collection_groups (userId, id, name, createdAt) VALUES (?,?,?,?)').run(
    userId,
    `grp-${userId}`,
    'A group',
    NOW,
  );
  db.prepare(
    'INSERT INTO vocab (userId, id, text, type, sentence, translation, state, stateUpdatedAt, createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(userId, `voc-${userId}`, 'woord', 'word', 'n sin', 'a sentence', 'new', NOW, NOW);
  db.prepare(
    'INSERT INTO clozeSentences (userId, id, sentence, clozeWord, clozeIndex, translation, source, collection, nextReview) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(userId, `clz-${userId}`, 'n sin', 'woord', 0, 'a sentence', 'tatoeba', 'top500', NOW);
  db.prepare('INSERT INTO knownWords (userId, word, language, state) VALUES (?,?,?,?)').run(
    userId,
    `word-${userId}`,
    'af',
    'known',
  );
  db.prepare('INSERT INTO dailyStats (userId, date, language) VALUES (?,?,?)').run(
    userId,
    '2026-07-14',
    'af',
  );
  db.prepare(
    'INSERT INTO journal_entries (userId, id, entryDate, createdAt, updatedAt) VALUES (?,?,?,?,?)',
  ).run(userId, `jnl-${userId}`, '2026-07-14', NOW, NOW);
  db.prepare(
    'INSERT INTO chat_messages (userId, id, role, content, createdAt) VALUES (?,?,?,?,?)',
  ).run(userId, `cht-${userId}`, 'user', 'hallo', NOW);
  db.prepare('INSERT INTO settings (userId, key, value) VALUES (?,?,?)').run(
    userId,
    'theme',
    '"dark"',
  );
  db.prepare(
    'INSERT INTO api_tokens (userId, id, name, tokenHash, createdAt) VALUES (?,?,?,?,?)',
  ).run(userId, `tok-${userId}`, 'CLI', `hash-${userId}`, NOW);
  db.prepare(
    'INSERT INTO learner_profiles (userId, language, approximateLevel, dailyMinutes, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(userId, 'af', 'new', 15, NOW, NOW);
  db.prepare(
    'INSERT INTO onboarding_progress (userId, status, currentStep, language, startedAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(userId, 'in_progress', 'reader', 'af', NOW, NOW);
  db.prepare(
    'INSERT INTO learner_events (userId, id, eventType, language, occurredAt) VALUES (?,?,?,?,?)',
  ).run(userId, `evt-${userId}`, 'lesson_opened', 'af', NOW);
  db.prepare(
    'INSERT INTO usage_counters (userId, metric, period, value, updatedAt) VALUES (?,?,?,?,?)',
  ).run(userId, 'journalWords', '2026-07', 10, NOW);
  db.prepare(
    'INSERT INTO user_provider_credentials (userId, provider, ciphertext, model, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(userId, 'openai', 'ENCRYPTED-KEY', 'gpt-5', NOW, NOW);
  db.prepare(
    'INSERT INTO cached_entries (userId, word, language, sourceSentence, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(userId, `woord-${userId}`, 'af', 'a sentence from my reading', NOW, NOW);
  db.prepare('INSERT INTO anki_pending (userId, vocabId, cardType, queuedAt) VALUES (?,?,?,?)').run(
    userId,
    `voc-${userId}`,
    'basic',
    NOW,
  );
  db.prepare(
    'INSERT INTO admin_account_flags (userId, suspended, reason, updatedAt) VALUES (?,?,?,?)',
  ).run(userId, 0, 'note', NOW);
  db.prepare(
    'INSERT INTO billing_customers (paddleCustomerId, email, occurredAt, updatedAt) VALUES (?,lower(?),?,?)',
  ).run(customerId, email, NOW, NOW);
  db.prepare(
    'INSERT INTO billing_subscriptions (paddleSubscriptionId, paddleCustomerId, userId, status, occurredAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(`sub-${userId}`, customerId, userId, 'active', NOW, NOW);
}

function customerCount(paddleCustomerId: string): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS c FROM billing_customers WHERE paddleCustomerId = ?')
      .get(paddleCustomerId) as {
      c: number;
    }
  ).c;
}

describe('purgeTenantData', () => {
  beforeEach(() => {
    clearAll();
    seed(USER_A, EMAIL_A, CUSTOMER_A);
    seed(USER_B, EMAIL_B, CUSTOMER_B);
  });

  test('erases every seeded tenant table for the target user and leaves others intact', () => {
    purgeTenantData(USER_A, EMAIL_A);

    for (const table of SEEDED_TABLES) {
      expect({ table, rows: rowsFor(table, USER_A) }).toEqual({ table, rows: 0 });
      expect({ table, rows: rowsFor(table, USER_B) }).toEqual({ table, rows: 1 });
    }
  });

  test('erases the encrypted BYOK credential and the per-user translation cache', () => {
    // The rows an earlier list missed — the reviewer's headline cases.
    expect(rowsFor('user_provider_credentials', USER_A)).toBe(1);
    expect(rowsFor('cached_entries', USER_A)).toBe(1);

    purgeTenantData(USER_A, EMAIL_A);

    expect(rowsFor('user_provider_credentials', USER_A)).toBe(0);
    expect(rowsFor('cached_entries', USER_A)).toBe(0);
  });

  test('drops the Paddle customer mirror for the target user only', () => {
    purgeTenantData(USER_A, EMAIL_A);

    expect(customerCount(CUSTOMER_A)).toBe(0);
    expect(customerCount(CUSTOMER_B)).toBe(1);
  });

  test('removes a billing_customers row matched by email even with no subscription link', () => {
    // A checkout made before the account existed: a customer row keyed on the
    // user's email, but no subscription tying its customer id to the userId.
    db.prepare(
      'INSERT INTO billing_customers (paddleCustomerId, email, occurredAt, updatedAt) VALUES (?,lower(?),?,?)',
    ).run('ctm_orphan', EMAIL_A, NOW, NOW);

    purgeTenantData(USER_A, EMAIL_A);

    expect(customerCount('ctm_orphan')).toBe(0);
  });

  test('refuses to run without a userId', () => {
    expect(() => purgeTenantData('')).toThrow(/without a userId/);
    // and nothing was touched
    expect(rowsFor('collections', USER_A)).toBe(1);
  });
});

describe('ERASURE_TABLES completeness ratchet', () => {
  // The mirror of adopt-local-data.test.ts's ratchet: every table carrying a
  // userId column in a fully-migrated DB must be erased, so the NEXT tenant
  // table added to the schema cannot silently survive account deletion.
  //
  // Better Auth's own userId-carrying tables (user/session/account/twoFactor)
  // are absent from the getDb schema — session/account are deleted by Better
  // Auth itself; twoFactor is in ERASURE_TABLES for the real cloud DB where it
  // exists. admin_audit_log is keyed by actor/targetUserId (not `userId`), so
  // it is correctly not enumerated here and is retained on purpose.
  // Better Auth deletes session/account rows itself on user deletion, and
  // neither is a getDb migration — they only appear in the shared .test-data
  // DB when a file that fabricates them (admin.test.ts) runs first. Subtract
  // them so the ratchet is file-order-independent, same as adopt-local-data's
  // NON_TENANT_USERID_TABLES.
  const BETTER_AUTH_MANAGED = new Set(['session', 'account']);

  test('every userId-carrying table in the migrated schema is in ERASURE_TABLES', () => {
    const database = getDatabaseInstance();
    const names = (
      database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((t) => t.name);

    const withUserId = names.filter(
      (name) =>
        !BETTER_AUTH_MANAGED.has(name) &&
        (database.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).some(
          (c) => c.name === 'userId',
        ),
    );

    const covered = new Set<string>(ERASURE_TABLES);
    const escaped = withUserId.filter((name) => !covered.has(name)).sort();
    expect(escaped).toEqual([]);
  });
});
