import '../test-guard';
import { describe, test, expect, beforeEach } from 'bun:test';
import { db } from '../db';
import { purgeTenantData } from './account-deletion';

/**
 * Right-to-erasure (#227): purgeTenantData must wipe EVERY userId-scoped table
 * for one tenant, leave every other tenant untouched, and never touch the
 * globally-shared read caches. Runs against the isolated .test-data DB
 * (test-guard refuses anything else).
 */

const USER_A = 'user-aaa';
const USER_B = 'user-bbb';
const EMAIL_A = 'a@erasure.test';
const EMAIL_B = 'b@erasure.test';
const CUSTOMER_A = 'ctm_aaa';
const CUSTOMER_B = 'ctm_bbb';
const NOW = '2026-07-14T00:00:00Z';

// Mirror of account-deletion.ts's sweep — asserted table-by-table below.
const TENANT_TABLES = [
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
  'billing_subscriptions',
] as const;

function clearAll() {
  for (const t of TENANT_TABLES) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare('DELETE FROM billing_customers').run();
  db.prepare("DELETE FROM cached_entries WHERE word = 'erasuretestword'").run();
}

function rowsFor(table: string, userId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE userId = ?`).get(userId) as { c: number }).c;
}

/** One row in every tenant table (+ the Paddle mirror pair) for `userId`. */
function seed(userId: string, email: string, customerId: string) {
  db.prepare('INSERT INTO collections (userId, id, title, createdAt, lastReadAt) VALUES (?,?,?,?,?)')
    .run(userId, `col-${userId}`, 'A book', NOW, NOW);
  db.prepare('INSERT INTO lessons (userId, id, title, createdAt, lastReadAt) VALUES (?,?,?,?,?)')
    .run(userId, `les-${userId}`, 'A lesson', NOW, NOW);
  db.prepare('INSERT INTO collection_groups (userId, id, name, createdAt) VALUES (?,?,?,?)')
    .run(userId, `grp-${userId}`, 'A group', NOW);
  db.prepare(
    'INSERT INTO vocab (userId, id, text, type, sentence, translation, state, stateUpdatedAt, createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(userId, `voc-${userId}`, 'woord', 'word', 'n sin', 'a sentence', 'new', NOW, NOW);
  db.prepare(
    'INSERT INTO clozeSentences (userId, id, sentence, clozeWord, clozeIndex, translation, source, collection, nextReview) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(userId, `clz-${userId}`, 'n sin', 'woord', 0, 'a sentence', 'tatoeba', 'top500', NOW);
  db.prepare('INSERT INTO knownWords (userId, word, language, state) VALUES (?,?,?,?)')
    .run(userId, `word-${userId}`, 'af', 'known');
  db.prepare('INSERT INTO dailyStats (userId, date, language) VALUES (?,?,?)')
    .run(userId, '2026-07-14', 'af');
  db.prepare('INSERT INTO journal_entries (userId, id, entryDate, createdAt, updatedAt) VALUES (?,?,?,?,?)')
    .run(userId, `jnl-${userId}`, '2026-07-14', NOW, NOW);
  db.prepare('INSERT INTO chat_messages (userId, id, role, content, createdAt) VALUES (?,?,?,?,?)')
    .run(userId, `cht-${userId}`, 'user', 'hallo', NOW);
  db.prepare('INSERT INTO settings (userId, key, value) VALUES (?,?,?)').run(userId, 'theme', '"dark"');
  db.prepare('INSERT INTO api_tokens (userId, id, name, tokenHash, createdAt) VALUES (?,?,?,?,?)')
    .run(userId, `tok-${userId}`, 'CLI', `hash-${userId}`, NOW);
  db.prepare('INSERT INTO billing_customers (paddleCustomerId, email, occurredAt, updatedAt) VALUES (?,?,?,?)')
    .run(customerId, email, NOW, NOW);
  db.prepare(
    'INSERT INTO billing_subscriptions (paddleSubscriptionId, paddleCustomerId, userId, status, occurredAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(`sub-${userId}`, customerId, userId, 'active', NOW, NOW);
}

function customerCount(paddleCustomerId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS c FROM billing_customers WHERE paddleCustomerId = ?').get(paddleCustomerId) as {
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

  test('erases every tenant table for the target user and leaves others intact', () => {
    purgeTenantData(USER_A, EMAIL_A);

    for (const table of TENANT_TABLES) {
      expect(rowsFor(table, USER_A)).toBe(0);
      expect(rowsFor(table, USER_B)).toBe(1);
    }
  });

  test('drops the Paddle customer mirror for the target user only', () => {
    purgeTenantData(USER_A, EMAIL_A);

    expect(customerCount(CUSTOMER_A)).toBe(0);
    expect(customerCount(CUSTOMER_B)).toBe(1);
  });

  test('removes a billing_customers row matched by email even with no subscription link', () => {
    // A checkout made before the account existed: a customer row keyed on the
    // user's email, but no subscription tying its customer id to the userId.
    db.prepare('INSERT INTO billing_customers (paddleCustomerId, email, occurredAt, updatedAt) VALUES (?,?,?,?)')
      .run('ctm_orphan', EMAIL_A, NOW, NOW);

    purgeTenantData(USER_A, EMAIL_A);

    expect(customerCount('ctm_orphan')).toBe(0);
  });

  test('leaves globally-shared dictionary caches untouched', () => {
    db.prepare(
      'INSERT INTO cached_entries (word, language, createdAt, updatedAt) VALUES (?,?,?,?)',
    ).run('erasuretestword', 'af', NOW, NOW);

    purgeTenantData(USER_A, EMAIL_A);

    const cached = db
      .prepare("SELECT COUNT(*) AS c FROM cached_entries WHERE word = 'erasuretestword'")
      .get() as { c: number };
    expect(cached.c).toBe(1);
  });

  test('refuses to run without a userId', () => {
    expect(() => purgeTenantData('')).toThrow(/without a userId/);
    // and nothing was touched
    expect(rowsFor('collections', USER_A)).toBe(1);
  });
});
