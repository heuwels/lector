/**
 * Right-to-erasure (#227, GDPR Art 17 / AU APP 11): wipe every scrap of one
 * tenant's data. Called from the Better Auth `deleteUser` hook (lib/accounts.ts)
 * the moment a deletion is confirmed, alongside Better Auth's own removal of the
 * user/session/account/verification rows.
 *
 * Every user-data table carries a `userId` (db.ts, plan 010 — the tenant axis),
 * so erasure is a fixed sweep of DELETEs keyed on it. The globally-shared read
 * caches (cached_entries / cached_senses / cached_related_forms, the read-only
 * dictionaries, and the Tatoeba sentence banks) are deliberately absent: they
 * hold no personal data and are keyed by word, not user (plan 010).
 */
import { db } from '../db';

/**
 * The userId-scoped tables, in an order safe to delete top-to-bottom (foreign
 * keys are off app-wide — see routes/groups.ts — so order is not load-bearing,
 * but children-before-parents keeps it correct if they're ever enforced).
 * `billing_subscriptions` carries a userId too (the Paddle mirror, #224); its
 * companion `billing_customers` has no userId and is handled separately below.
 */
const TENANT_TABLES = [
  'lessons',
  'collections',
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

/**
 * Delete all data belonging to `userId`. Runs in a single transaction so the
 * account is either fully erased or untouched — never half-gone.
 *
 * `email` (the deleting user's account email) lets us also drop the
 * `billing_customers` mirror rows for this person: that table keys on Paddle's
 * customer id + email with no userId, so it's matched via the tenant's own
 * subscription rows (captured before they're deleted) and by email as a
 * fallback for a checkout made under a different address. Deleting the mirror
 * is local-only — Paddle, the merchant of record, remains the controller of the
 * actual billing record, and a subscription is NOT cancelled by erasing here.
 */
export function purgeTenantData(userId: string, email?: string): void {
  if (!userId) {
    // A blank userId would either match nothing or, worse, invite a bug that
    // sweeps a shared pseudo-tenant. Fail loudly instead.
    throw new Error('purgeTenantData: refusing to run without a userId');
  }

  const run = db.transaction(() => {
    const customerIds = (
      db
        .prepare('SELECT DISTINCT paddleCustomerId FROM billing_subscriptions WHERE userId = ?')
        .all(userId) as { paddleCustomerId: string }[]
    ).map((r) => r.paddleCustomerId);

    for (const table of TENANT_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE userId = ?`).run(userId);
    }

    for (const customerId of customerIds) {
      db.prepare('DELETE FROM billing_customers WHERE paddleCustomerId = ?').run(customerId);
    }
    if (email) {
      db.prepare('DELETE FROM billing_customers WHERE email = ?').run(email);
    }
  });
  run();
}
