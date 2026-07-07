import type { Context } from 'hono';

/**
 * The single implicit user every self-hosted deployment (and the gated cloud
 * canary) runs as. A constant, not a UUID, so self-host databases stay
 * human-inspectable (plan 010).
 */
export const LOCAL_USER_ID = 'local';

/**
 * The identity seam (#217 / plan 010 piece 3). Every user-data query scopes
 * by the value this returns — unconditionally, in both deployment modes, so
 * the self-host e2e suite exercises the exact isolation queries cloud relies
 * on and the userId-scoping ratchet guards a single code path.
 *
 * Until accounts ship (#218) it always resolves the local user. Better Auth
 * replaces the BODY of this function (session -> userId; no session in cloud
 * mode -> the middleware 401s before routes run) — never the call sites.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the context is the seam's whole point; #218 reads the session from it
export function getCurrentUserId(_c?: Context): string {
  return LOCAL_USER_ID;
}
