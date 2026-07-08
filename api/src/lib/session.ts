/**
 * Session middleware (#218): the cloud-mode counterpart to the selfhost
 * passthrough. Runs on every /api/* request BEFORE the PAT middleware
 * (lib/auth.ts):
 *
 *   - selfhost / external gate → no-op. Today's behaviour, byte for byte:
 *     local access passes through, PATs keep working.
 *   - cloud proper (authRequired) → a valid Better Auth session cookie is
 *     the only accepted credential. No session → 401 before any route runs;
 *     a session resolves the tenant and stows it as `userId` in context for
 *     getCurrentUserId (lib/user.ts).
 *
 * Cloud-mode carve-outs:
 *   - `/api/auth/*` skips the check — signup/login/verify/reset/OAuth
 *     callbacks must be reachable unauthenticated (Better Auth guards its
 *     own endpoints).
 *   - A Bearer header hands the request to the PAT middleware instead
 *     (#218): api_tokens rows are tenanted, so a per-user token is a first-
 *     class credential — lib/auth.ts validates it and resolves its userId
 *     into context exactly like a session would. Every Bearer-carrying
 *     request is authenticated THERE; nothing falls through unchecked
 *     (invalid, expired, pre-accounts and out-of-scope tokens are all
 *     rejected by that middleware).
 */
import { createMiddleware } from 'hono/factory';
import { config } from './config';
import { getAuthEngine, type AuthEngine } from './accounts';

declare module 'hono' {
  interface ContextVariableMap {
    /** Tenant resolved from the Better Auth session (cloud mode only). */
    userId: string;
  }
}

export function makeSessionMiddleware(authRequired: boolean, engine: () => AuthEngine) {
  return createMiddleware(async (c, next) => {
    if (!authRequired) return next();

    if (c.req.path.startsWith('/api/auth/')) return next();

    // Paddle webhook (#224): server-to-server, so it carries no session or
    // PAT — the HMAC signature over the raw body is its credential, verified
    // in routes/billing.ts before anything is touched.
    if (c.req.path === '/api/billing/webhook') return next();

    // Per-user PAT (#218): defer to the PAT middleware mounted right after
    // this one — it authenticates the token and resolves its tenant.
    if (c.req.header('Authorization')) return next();

    const session = await engine().api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    c.set('userId', session.user.id);
    return next();
  });
}

/** The prod middleware, bound to the resolved deployment config. */
export const sessionMiddleware = makeSessionMiddleware(config.authRequired, getAuthEngine);
