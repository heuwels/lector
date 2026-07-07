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
 *   - Bearer tokens are REJECTED, not ignored: api_tokens has no userId yet,
 *     so a PAT cannot resolve a tenant. Fail loudly rather than let a token
 *     grant ambient access to nothing in particular. (Per-user PATs are a
 *     follow-up — see #218.)
 *   - `/api/tokens` (PAT management) is blocked even with a session: the
 *     table is untenanted, so listing would show every row to every user.
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

    if (c.req.header('Authorization')) {
      return c.json(
        { error: 'API tokens are not available in cloud mode yet — authenticate with a session' },
        401,
      );
    }

    const session = await engine().api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    if (c.req.path.startsWith('/api/tokens')) {
      return c.json({ error: 'API token management is not available in cloud mode yet' }, 403);
    }

    c.set('userId', session.user.id);
    return next();
  });
}

/** The prod middleware, bound to the resolved deployment config. */
export const sessionMiddleware = makeSessionMiddleware(config.authRequired, getAuthEngine);
