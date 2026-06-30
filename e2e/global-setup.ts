import { request } from '@playwright/test';

/**
 * Set the target language before any tests run, so the SetupGuard
 * doesn't redirect every test to /setup. This writes straight to the Hono API
 * on :3457 — the client used to reach it via the Next `/api` proxy, but that
 * proxy is gone (#188), so settings are seeded against the API directly.
 */
async function globalSetup() {
  const ctx = await request.newContext({ baseURL: 'http://localhost:3457' });

  await ctx.put('/api/settings/targetLanguage', {
    data: { value: 'af' },
  });

  await ctx.dispose();
}

export default globalSetup;
