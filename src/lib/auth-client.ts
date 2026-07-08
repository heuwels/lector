/**
 * Better Auth browser client (#218) — only ever exercised in cloud mode
 * (selfhost never mounts /api/auth/* and never renders the auth pages).
 *
 * baseURL resolves through the same runtime rail as every API call
 * (window.__ENV__.API_URL → api-base.ts); the engine mounts at /api/auth,
 * the client's default basePath. Cookies must ride cross-origin in dev
 * (UI :3456 → API :3457, same-site), hence credentials: 'include' — cloud
 * CORS pins origins + allows credentials (api/src/index.ts).
 */
import { createAuthClient } from 'better-auth/react';
import { genericOAuthClient } from 'better-auth/client/plugins';
import { apiBase } from './api-base';

export const authClient = createAuthClient({
  baseURL: apiBase(),
  fetchOptions: {
    credentials: 'include',
  },
  // signIn.oauth2 for the BYO OIDC provider (#218) — server-side twin in
  // api/src/lib/accounts.ts (genericOAuth, providerId 'oidc').
  plugins: [genericOAuthClient()],
});

// Route helpers live in api-base (this module imports it; the reverse would
// cycle). Re-exported here since consumers reach for them alongside the client.
export { AUTH_ROUTES, isAuthRoute } from './api-base';
