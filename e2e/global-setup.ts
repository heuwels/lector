import { request } from '@playwright/test';
import { API_BASE } from './api';

/**
 * Set the target language before any tests run, so the SetupGuard doesn't
 * redirect every test to /setup. Writes straight to the Hono API (the client
 * used to reach it via the Next `/api` proxy, but that's gone — #188) at
 * API_BASE, which is configurable via E2E_API_URL.
 */
async function globalSetup() {
  const ctx = await request.newContext({ baseURL: API_BASE });

  await ctx.put('/api/settings/targetLanguage', {
    data: { value: 'af' },
  });

  await ctx.dispose();
}

export default globalSetup;
