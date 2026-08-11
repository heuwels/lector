/**
 * Admin impersonation (#320) — an operator "view as a user" for support/debug.
 *
 * A custom identity-swap, deliberately NOT Better Auth's `admin` plugin: this
 * codebase gates admin by an env allowlist (lib/admin.ts) and routes every
 * user-data query through the one `getCurrentUserId` seam (lib/user.ts). The
 * swap rides that seam — after session/PAT resolves the operator's real userId,
 * this middleware replaces `c.get('userId')` with the impersonation target on
 * ordinary routes, so every route serves the target's data with no per-route
 * change. The operator's real id is preserved as `impersonatorId`.
 *
 * Guardrails baked in here:
 *   - CLOUD-ONLY (config.authRequired) — selfhost has one implicit user.
 *   - The control planes stay the operator's own identity (never swapped):
 *     /api/admin/* (the dashboard + the stop button), /api/auth/*, and
 *     /api/impersonation/* (the banner's status probe).
 *   - READ-ONLY: while impersonating, any mutating method (POST/PUT/PATCH/
 *     DELETE) on a swapped route is refused (403), because a write would be
 *     indistinguishable from the user's own. Stop lives on a control plane, so
 *     exiting is always reachable.
 *   - HARD TIME-BOX: a grant older than IMPERSONATION_TTL_MS is inert and
 *     lazily deleted, so a forgotten session can't linger.
 */
import { createMiddleware } from 'hono/factory';
import { db } from '../db';
import { config } from './config';

/** Hard expiry for an impersonation grant (30 minutes). */
export const IMPERSONATION_TTL_MS = 30 * 60 * 1000;

/** Paths that keep the operator's own identity — never swapped to the target. */
const CONTROL_PREFIXES = ['/api/admin/', '/api/auth/', '/api/impersonation/'];

export interface ImpersonationGrant {
  actorUserId: string;
  targetUserId: string;
  targetEmail: string | null;
  startedAt: string;
  expiresAt: string;
}

interface GrantRow {
  actorUserId: string;
  targetUserId: string;
  targetEmail: string | null;
  startedAt: string;
  expiresAt: string;
}

/**
 * The operator's active grant, or null. A grant at/past its expiry is treated
 * as absent and deleted in passing, so callers never see a stale one.
 */
export function activeImpersonation(
  actorUserId: string,
  now: () => Date = () => new Date(),
): ImpersonationGrant | null {
  const row = db
    .prepare('SELECT * FROM admin_impersonation WHERE actorUserId = ?')
    .get(actorUserId) as GrantRow | undefined;
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= now().getTime()) {
    db.prepare('DELETE FROM admin_impersonation WHERE actorUserId = ?').run(actorUserId);
    return null;
  }
  return row;
}

/** Begin (or replace) the operator's impersonation of `target`. Returns the grant. */
export function startImpersonation(
  actorUserId: string,
  target: { userId: string; email: string | null },
  now: () => Date = () => new Date(),
): ImpersonationGrant {
  const startedAt = now();
  const grant: ImpersonationGrant = {
    actorUserId,
    targetUserId: target.userId,
    targetEmail: target.email,
    startedAt: startedAt.toISOString(),
    expiresAt: new Date(startedAt.getTime() + IMPERSONATION_TTL_MS).toISOString(),
  };
  db.prepare(
    `INSERT INTO admin_impersonation (actorUserId, targetUserId, targetEmail, startedAt, expiresAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(actorUserId) DO UPDATE SET
       targetUserId = excluded.targetUserId,
       targetEmail = excluded.targetEmail,
       startedAt = excluded.startedAt,
       expiresAt = excluded.expiresAt`,
  ).run(grant.actorUserId, grant.targetUserId, grant.targetEmail, grant.startedAt, grant.expiresAt);
  return grant;
}

/**
 * End the operator's impersonation. Returns the ended grant plus how long it
 * ran (for the audit note), or null if there was nothing active.
 */
export function stopImpersonation(
  actorUserId: string,
  now: () => Date = () => new Date(),
): { grant: ImpersonationGrant; durationMs: number } | null {
  const row = db
    .prepare('SELECT * FROM admin_impersonation WHERE actorUserId = ?')
    .get(actorUserId) as GrantRow | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM admin_impersonation WHERE actorUserId = ?').run(actorUserId);
  return { grant: row, durationMs: now().getTime() - new Date(row.startedAt).getTime() };
}

function isControlPath(path: string): boolean {
  return CONTROL_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export interface ImpersonationMiddlewareOptions {
  /** Cloud proper — the only mode with accounts to impersonate. */
  enabled: boolean;
  /** Test seam: override the active-grant lookup. */
  lookup?: (actorUserId: string) => ImpersonationGrant | null;
  now?: () => Date;
}

/**
 * The identity-swap middleware. Mounted after session/PAT (so the real userId
 * is resolved) and before the account-status/billing gates (so an impersonated
 * suspended/lapsed account is experienced exactly as that user sees it).
 */
export function makeImpersonationMiddleware(opts: ImpersonationMiddlewareOptions) {
  const lookup = opts.lookup ?? ((id: string) => activeImpersonation(id, opts.now));
  return createMiddleware(async (c, next) => {
    if (!opts.enabled) return next();
    if (isControlPath(c.req.path)) return next();

    const actorUserId = c.get('userId');
    if (typeof actorUserId !== 'string' || actorUserId.length === 0) return next();

    const grant = lookup(actorUserId);
    if (!grant) return next();

    // Swap identity for this request: downstream getCurrentUserId now reads the
    // target, while the operator's real id stays available for logging/guards.
    c.set('impersonatorId', actorUserId);
    c.set('userId', grant.targetUserId);

    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD') {
      return c.json({ error: 'impersonation_read_only' }, 403);
    }
    return next();
  });
}

/** The prod middleware, enabled in cloud proper. */
export const impersonationMiddleware = makeImpersonationMiddleware({
  enabled: config.authRequired,
});
