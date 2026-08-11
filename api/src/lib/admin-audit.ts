/**
 * Admin audit log (#221 follow-up) — append-only record of operator actions.
 * db-only (no cycle with lib/admin or lib/billing). Every mutating admin
 * endpoint calls record() so there is one accountable trail of who did what
 * to whom, especially before there's ever a second operator.
 */
import { db } from '../db';

/** The operator actions we log. Kept as a union so callers can't typo one. */
export type AdminAction =
  | 'suspend'
  | 'restore'
  | 'comp'
  | 'uncomp'
  | 'reset_mfa'
  | 'password_reset'
  | 'resend_verification'
  | 'force_verify'
  | 'revoke_sessions'
  | 'paddle_resync'
  | 'export'
  | 'impersonate_start'
  | 'impersonate_stop';

export interface AuditEntry {
  actorUserId: string;
  actorEmail: string | null;
  action: AdminAction;
  targetUserId: string;
  targetEmail: string | null;
  /** Short human note — reason, comped tier, session count, etc. */
  detail?: string | null;
}

export function recordAdminAction(entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO admin_audit_log (actorUserId, actorEmail, action, targetUserId, targetEmail, detail, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.actorUserId,
    entry.actorEmail,
    entry.action,
    entry.targetUserId,
    entry.targetEmail ?? null,
    entry.detail ?? null,
    new Date().toISOString(),
  );
}

export interface AuditRow {
  id: number;
  actorUserId: string;
  actorEmail: string | null;
  action: string;
  targetUserId: string | null;
  targetEmail: string | null;
  detail: string | null;
  createdAt: string;
}

/** Most recent audit entries, newest first. */
export function recentAuditLog(limit = 100): AuditRow[] {
  return db
    .prepare('SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT ?')
    .all(limit) as AuditRow[];
}
