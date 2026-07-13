/**
 * Right-to-erasure (#227, GDPR Art 17 / AU APP 11): wipe every scrap of one
 * tenant's data. Called from the Better Auth `deleteUser` hook (lib/accounts.ts)
 * the moment a deletion is confirmed, alongside Better Auth's own removal of the
 * user/session/account/verification rows.
 *
 * The source of truth for "every table that carries a userId" is TENANT_TABLES
 * in adopt-local-data.ts — the same ratchet-tested list the selfhost→cloud
 * adoption tool moves. Erasure REUSES it rather than re-deriving it (a
 * hand-rolled copy already drifted once and shipped two-thirds of the surface).
 * To it we add the userId-carrying tables adoption deliberately skips but a
 * deleted account must still shed:
 *   - billing_subscriptions — the Paddle mirror's link to this account. Best
 *     effort: an ACTIVE subscription keeps emitting webhook events that
 *     re-insert the row (and billing_customers) until it reaches a terminal
 *     state, so the UI tells users to cancel billing first. Full webhook-side
 *     tombstoning is a follow-up (tracked on #227).
 *   - admin_account_flags — operator suspension/comp state, meaningless once
 *     the account is gone.
 *   - twoFactor — Better Auth's TOTP secret + backup codes. Its own deleteUser
 *     removes only user/session/account, and FKs are off app-wide, so this
 *     would otherwise outlive the account.
 *
 * Deliberately NOT erased:
 *   - user / session / account / verification — Better Auth removes these
 *     itself, in the same request, before this hook runs.
 *   - admin_audit_log — append-only accountability trail keyed by
 *     actor/targetUserId, off the tenant `userId` axis (db.ts); retained on
 *     purpose as the operator-action record.
 *   - classify_batches — a singleton in-flight job row with no userId column;
 *     any (userId, word) tuples inside its `requests` JSON are transient (≤1
 *     row, cleared when the batch completes).
 *
 * A ratchet test (account-deletion.test.ts) asserts every userId-carrying table
 * in a freshly migrated DB is covered here, so a future tenant table cannot
 * silently escape erasure.
 */
import { db } from '../db';
import { TENANT_TABLES } from './adopt-local-data';

export const ERASURE_TABLES = [
  ...TENANT_TABLES,
  'billing_subscriptions',
  'admin_account_flags',
  'twoFactor',
] as const;

/**
 * Delete all data belonging to `userId`. Runs in a single transaction so the
 * account is either fully erased or untouched — never half-gone.
 *
 * `email` (the deleting user's account email) also drops the `billing_customers`
 * mirror rows for this person: that table keys on Paddle's customer id + email
 * with no userId, so it's matched via the tenant's own subscription rows
 * (captured before they're deleted) and by email as a fallback for a checkout
 * made under a different address. Deleting the mirror is local-only — Paddle,
 * the merchant of record, stays the controller of the billing record, and a
 * subscription is NOT cancelled by erasing here.
 */
export function purgeTenantData(userId: string, email?: string): void {
  if (!userId) {
    // A blank userId would either match nothing or, worse, invite a bug that
    // sweeps a shared pseudo-tenant. Fail loudly instead.
    throw new Error('purgeTenantData: refusing to run without a userId');
  }

  // Some tables are Better Auth's (twoFactor) or otherwise cloud-only; the
  // sweep must stay safe on a selfhost/test DB that never ran those migrations.
  const present = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );

  const run = db.transaction(() => {
    // Capture the Paddle customer ids linked to this tenant BEFORE deleting the
    // subscription rows, so the billing_customers mirror can be cleared too.
    const customerIds = present.has('billing_subscriptions')
      ? (
          db
            .prepare('SELECT DISTINCT paddleCustomerId FROM billing_subscriptions WHERE userId = ?')
            .all(userId) as { paddleCustomerId: string }[]
        ).map((r) => r.paddleCustomerId)
      : [];

    for (const table of ERASURE_TABLES) {
      if (!present.has(table)) continue;
      db.prepare(`DELETE FROM ${table} WHERE userId = ?`).run(userId);
    }

    if (present.has('billing_customers')) {
      for (const customerId of customerIds) {
        db.prepare('DELETE FROM billing_customers WHERE paddleCustomerId = ?').run(customerId);
      }
      if (email) {
        // billing_customers.email is stored lower-cased by the webhook (billing.ts).
        db.prepare('DELETE FROM billing_customers WHERE email = lower(?)').run(email);
      }
    }
  });
  run();
}
