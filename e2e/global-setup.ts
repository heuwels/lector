import { request } from '@playwright/test';

/**
 * Set the target language before any tests run, so the SetupGuard
 * doesn't redirect every test to /setup.
 */
async function globalSetup() {
  const baseURL = 'http://localhost:3456';
  const ctx = await request.newContext({ baseURL });

  await ctx.put('/api/settings/targetLanguage', {
    data: { value: 'af' },
  });

  await ctx.dispose();
}

export default globalSetup;
