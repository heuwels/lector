import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { config } from './config';

/**
 * The single implicit user every self-hosted deployment (and the gated cloud
 * canary) runs as. A constant, not a UUID, so self-host databases stay
 * human-inspectable (plan 010).
 */
export const LOCAL_USER_ID = 'local';

/**
 * The identity seam (#217 / plan 010 piece 3), now session-backed (#218).
 * Every user-data query scopes by the value this returns — unconditionally,
 * in both deployment modes, so the self-host e2e suite exercises the exact
 * isolation queries cloud relies on and the userId-scoping ratchet guards a
 * single code path.
 *
 * Selfhost / external gate: always the implicit local user, as it has been
 * since #217. Cloud proper: the tenant the session middleware (lib/session.ts)
 * resolved into context. A missing tenant in cloud mode fails CLOSED — 401,
 * never a silent fall-through to 'local', which would pool unauthenticated
 * writes into a shared pseudo-tenant.
 */
export function resolveUserId(authRequired: boolean, c?: Context): string {
  if (!authRequired) return LOCAL_USER_ID;
  const userId = c?.get('userId');
  if (typeof userId === 'string' && userId.length > 0) return userId;
  // Reachable only if a route was mounted outside sessionMiddleware — a
  // wiring bug. Surface it as the 401 it is rather than corrupt tenancy.
  throw new HTTPException(401, { message: 'Authentication required' });
}

export function getCurrentUserId(c?: Context): string {
  return resolveUserId(config.authRequired, c);
}
