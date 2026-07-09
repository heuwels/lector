/**
 * Admin gating (#221) — the operator-only surface for running the service.
 *
 * Who is an admin: an allowlist of account emails from `LECTOR_ADMIN_EMAILS`
 * (comma-separated), exactly mirroring `BILLING_EXEMPT_EMAILS` (lib/billing.ts).
 * This is deliberately an env allowlist, not a Better Auth `role` column:
 *
 *   - The cloud service is single-operator today; the only admin is us.
 *   - It composes with the existing config patterns and needs no Better Auth
 *     plugin / DB migration — which keeps it clear of the parallel work adding
 *     other Better Auth plugins (TOTP), whose migrations would otherwise race.
 *   - `isAdmin()` is the seam: swap its body for a `user.role` lookup later
 *     and every call site is unchanged.
 *
 * Admin is a CLOUD-ONLY concept: selfhost is single-user with no accounts to
 * manage, so `/api/admin/*` does not exist there (requireAdmin 404s). Gating
 * rides `config.authRequired` — true only in cloud proper — so an
 * external-gate canary (a single implicit 'local' user) also has no admin
 * area, which is correct: there are no per-user accounts to administer.
 */
import { createMiddleware } from 'hono/factory';
import { db } from '../db';
import { config } from './config';
import { getUserEmail } from './billing';

/** Comma-separated LECTOR_ADMIN_EMAILS → lowercased set (mirrors parseExemptEmails). */
export function parseAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Resolved admin config — read once at import, like billingConfig. */
export const adminConfig: {
  /** True only in cloud proper (per-user accounts exist to administer). */
  readonly enabled: boolean;
  readonly emails: Set<string>;
} = {
  enabled: config.authRequired,
  emails: parseAdminEmails(process.env.LECTOR_ADMIN_EMAILS),
};

export interface AdminGateOptions {
  enabled: boolean;
  emails: Set<string>;
  /** Test seam; prod uses the Better Auth `user`-table lookup. */
  resolveEmail?: (userId: string) => string | null;
}

/**
 * Is `userId` an admin? False whenever the admin surface is disabled (selfhost
 * / external gate) or the account's email is not in the allowlist. The email
 * comes from Better Auth's `user` table via getUserEmail (null-safe on
 * deployments without it), compared case-insensitively.
 */
export function isAdmin(userId: string, opts: AdminGateOptions): boolean {
  if (!opts.enabled) return false;
  const resolveEmail = opts.resolveEmail ?? getUserEmail;
  const email = resolveEmail(userId);
  return email !== null && opts.emails.has(email.toLowerCase());
}

/**
 * Gate for /api/admin/*. Mounted AFTER session + PAT middleware, so the tenant
 * is already resolved. Distinguishes "feature absent" from "forbidden":
 *   - selfhost / external gate → 404 (no admin surface exists here at all),
 *   - cloud non-admin → 403 admin_required,
 *   - cloud admin → through.
 * A PAT can never reach admin routes anyway: `admin` is absent from the PAT
 * SCOPE_MAP (lib/auth.ts), which default-denies — admin is a session concern.
 */
export function makeRequireAdmin(opts: AdminGateOptions) {
  return createMiddleware(async (c, next) => {
    if (!opts.enabled) return c.json({ error: 'Not found' }, 404);
    const userId = c.get('userId');
    if (typeof userId !== 'string' || userId.length === 0) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    if (!isAdmin(userId, opts)) {
      return c.json({ error: 'admin_required' }, 403);
    }
    return next();
  });
}

/** The prod gate, bound to the resolved admin config. */
export const requireAdmin = makeRequireAdmin(adminConfig);

// ---------------------------------------------------------------------------
// Account suspension (#221 support action: "suspend an abuser")
// ---------------------------------------------------------------------------
//
// A suspended account is locked to the same escape hatches as a billing-lapsed
// one (#224): auth, billing, data-takeout, and the admin surface stay
// reachable; everything else 403s. Enforcement lives in the account-status
// middleware below; this is just the flag store + helpers.

export interface SuspensionRow {
  userId: string;
  suspended: number;
  reason: string | null;
  updatedAt: string;
}

export function isSuspended(userId: string): boolean {
  const row = db
    .prepare('SELECT suspended FROM admin_account_flags WHERE userId = ?')
    .get(userId) as { suspended: number } | undefined;
  return row?.suspended === 1;
}

/** Set (or clear) an account's suspension. Records who/why for the audit trail. */
export function setSuspended(userId: string, suspended: boolean, reason: string | null): void {
  db.prepare(
    `INSERT INTO admin_account_flags (userId, suspended, reason, updatedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET
       suspended = excluded.suspended,
       reason = excluded.reason,
       updatedAt = excluded.updatedAt`,
  ).run(userId, suspended ? 1 : 0, reason, new Date().toISOString());
}

/** All suspended userIds → reason, for decorating the admin user list. */
export function suspendedMap(): Map<string, string | null> {
  const rows = db
    .prepare('SELECT userId, reason FROM admin_account_flags WHERE suspended = 1')
    .all() as { userId: string; reason: string | null }[];
  return new Map(rows.map((r) => [r.userId, r.reason]));
}

export interface AccountStatusOptions {
  /** Cloud proper — the only mode with accounts to suspend. */
  enabled: boolean;
  checkSuspended?: (userId: string) => boolean;
}

/**
 * Blocks a suspended account from everything except its escape hatches, the
 * lapse contract from #224 applied to a manual admin suspension:
 *   - /api/auth/*        — sign-in/out must work,
 *   - /api/billing/*     — status/checkout/webhook,
 *   - /api/admin/*       — the operator managing accounts is never self-locked
 *                          by this gate (requireAdmin still guards it),
 *   - GET /api/data      — data takeout stays open (no lock-in),
 * else 403 account_suspended. Mounted after PAT (tenant resolved), before the
 * billing gate. No-op unless cloud proper.
 */
export function makeAccountStatusMiddleware(opts: AccountStatusOptions) {
  const checkSuspended = opts.checkSuspended ?? isSuspended;
  return createMiddleware(async (c, next) => {
    if (!opts.enabled) return next();

    const path = c.req.path;
    if (path.startsWith('/api/auth/')) return next();
    if (path === '/api/billing' || path.startsWith('/api/billing/')) return next();
    if (path === '/api/admin' || path.startsWith('/api/admin/')) return next();
    if (path === '/api/data' && (c.req.method === 'GET' || c.req.method === 'HEAD')) return next();

    const userId = c.get('userId');
    // No resolved tenant → let the downstream gates answer (this middleware
    // only decides for an already-identified account).
    if (typeof userId !== 'string' || userId.length === 0) return next();

    if (checkSuspended(userId)) {
      return c.json({ error: 'account_suspended' }, 403);
    }
    return next();
  });
}

/** The prod middleware, enabled in cloud proper. */
export const accountStatusMiddleware = makeAccountStatusMiddleware({ enabled: config.authRequired });
