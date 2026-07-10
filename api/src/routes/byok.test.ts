import '../test-guard';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'crypto';
import { db } from '../db';
import app from './byok';

const previousKey = process.env.BYOK_ENCRYPTION_KEY;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.BYOK_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  db.prepare("DELETE FROM user_provider_credentials WHERE userId = 'local'").run();
  globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (previousKey === undefined) delete process.env.BYOK_ENCRYPTION_KEY;
  else process.env.BYOK_ENCRYPTION_KEY = previousKey;
});

describe('BYOK settings route', () => {
  test('validates, stores, reports only metadata, then disables', async () => {
    let validationRequest: Request | null = null;
    globalThis.fetch = (async (input, init) => {
      validationRequest = new Request(input, init);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const put = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-or-v1-secret', model: 'google/gemini-2.5-flash-lite' }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({
      enabled: true,
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-lite',
    });
    expect(validationRequest?.url).toBe('https://openrouter.ai/api/v1/key');
    expect(validationRequest?.headers.get('Authorization')).toBe('Bearer sk-or-v1-secret');

    const get = await app.request('/');
    const status = await get.json();
    expect(status.enabled).toBe(true);
    expect(JSON.stringify(status)).not.toContain('sk-or-v1-secret');

    expect((await app.request('/', { method: 'DELETE' })).status).toBe(200);
    expect((await (await app.request('/')).json()).enabled).toBe(false);
  });

  test('does not persist a key rejected by OpenRouter', async () => {
    globalThis.fetch = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch;
    const response = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'bad-secret', model: 'google/gemini-2.5-flash-lite' }),
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain('bad-secret');
    expect(
      db.prepare("SELECT 1 FROM user_provider_credentials WHERE userId = 'local'").get(),
    ).toBeNull();
  });

  test('rejects arbitrary models', async () => {
    const response = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'secret', model: 'attacker/model' }),
    });
    expect(response.status).toBe(400);
  });
});
