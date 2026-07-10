/**
 * Operator-set per-account flags (#221), backed by `admin_account_flags`.
 * Kept in its own module (depends only on `db`) so both the admin surface
 * (lib/admin.ts) and the billing gate (lib/billing.ts) can read it without an
 * import cycle.
 *
 * Two flags today:
 *   - suspended: locks an abuser out (lapse-style), enforced by
 *     accountStatusMiddleware.
 *   - compedPlan: complimentary membership at a tier — a comped tester gets
 *     'cloud' or 'plus' on the house: bypasses the Paddle subscription gate
 *     (like a BILLING_EXEMPT_EMAILS address, but per-account and tiered), and
 *     once the entitlements engine (#222) lands it resolves the account to the
 *     comped plan's limits/models rather than the base tier.
 */
import { db } from '../db';

/** The tiers an account can be comped to (mirrors billing plan ids). */
export type CompPlan = 'cloud' | 'plus';

export interface AccountFlagsRow {
  userId: string;
  suspended: number;
  compedPlan: CompPlan | null;
  reason: string | null;
  updatedAt: string;
}

export function isSuspended(userId: string): boolean {
  const row = db
    .prepare('SELECT suspended FROM admin_account_flags WHERE userId = ?')
    .get(userId) as { suspended: number } | undefined;
  return row?.suspended === 1;
}

/** The tier this account is comped to, or null if it isn't comped. */
export function getCompedPlan(userId: string): CompPlan | null {
  const row = db
    .prepare('SELECT compedPlan FROM admin_account_flags WHERE userId = ?')
    .get(userId) as { compedPlan: string | null } | undefined;
  const plan = row?.compedPlan;
  return plan === 'cloud' || plan === 'plus' ? plan : null;
}

/** True when the account has a comped membership (any tier) — the billing-gate bypass. */
export function isBillingExempt(userId: string): boolean {
  return getCompedPlan(userId) !== null;
}

/**
 * Upsert one flag on the account, preserving the other. `reason` is stored as
 * the latest operator note either action leaves (suspension reason, comp
 * note) — deliberately a single free-text field for the audit trail.
 */
function setFlag(
  userId: string,
  patch: { suspended?: boolean; compedPlan?: CompPlan | null },
  reason: string | null,
): void {
  const existing = db
    .prepare('SELECT suspended, compedPlan FROM admin_account_flags WHERE userId = ?')
    .get(userId) as { suspended: number; compedPlan: string | null } | undefined;
  const suspended = patch.suspended ?? (existing?.suspended === 1);
  const compedPlan =
    patch.compedPlan !== undefined ? patch.compedPlan : ((existing?.compedPlan as CompPlan | null) ?? null);
  db.prepare(
    `INSERT INTO admin_account_flags (userId, suspended, compedPlan, reason, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET
       suspended = excluded.suspended,
       compedPlan = excluded.compedPlan,
       reason = excluded.reason,
       updatedAt = excluded.updatedAt`,
  ).run(userId, suspended ? 1 : 0, compedPlan, reason, new Date().toISOString());
}

export function setSuspended(userId: string, suspended: boolean, reason: string | null): void {
  setFlag(userId, { suspended }, reason);
}

/** Comp the account to `plan` (or null to revoke), recording the operator note. */
export function setCompedPlan(userId: string, plan: CompPlan | null, reason: string | null): void {
  setFlag(userId, { compedPlan: plan }, reason);
}

/** All suspended userIds → reason, for decorating the admin user list. */
export function suspendedMap(): Map<string, string | null> {
  const rows = db
    .prepare('SELECT userId, reason FROM admin_account_flags WHERE suspended = 1')
    .all() as { userId: string; reason: string | null }[];
  return new Map(rows.map((r) => [r.userId, r.reason]));
}

/** userId → comped tier, for accounts with a complimentary membership. */
export function compedPlanMap(): Map<string, CompPlan> {
  const rows = db
    .prepare("SELECT userId, compedPlan FROM admin_account_flags WHERE compedPlan IS NOT NULL")
    .all() as { userId: string; compedPlan: string }[];
  const map = new Map<string, CompPlan>();
  for (const r of rows) {
    if (r.compedPlan === 'cloud' || r.compedPlan === 'plus') map.set(r.userId, r.compedPlan);
  }
  return map;
}
