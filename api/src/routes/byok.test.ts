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
  globalThis.fetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (previousKey === undefined) delete process.env.BYOK_ENCRYPTION_KEY;
  else process.env.BYOK_ENCRYPTION_KEY = previousKey;
});

describe('BYOK settings route', () => {
  test('validates, stores, reports only metadata, then disables', async () => {
    const captured: { request: Request | null } = { request: null };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.request = new Request(input, init);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
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
    expect(captured.request?.url).toBe('https://openrouter.ai/api/v1/key');
    expect(captured.request?.headers.get('Authorization')).toBe('Bearer sk-or-v1-secret');

    const get = await app.request('/');
    const status = await get.json();
    expect(status.enabled).toBe(true);
    expect(JSON.stringify(status)).not.toContain('sk-or-v1-secret');

    expect((await app.request('/', { method: 'DELETE' })).status).toBe(200);
    const reverted = await (await app.request('/')).json();
    expect(reverted.enabled).toBe(false);
    expect(
      db.prepare("SELECT 1 FROM user_provider_credentials WHERE userId = 'local'").get(),
    ).toBeNull();
  });

  test('does not persist a key rejected by OpenRouter', async () => {
    globalThis.fetch = (async () =>
      new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;
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

  test('validates and stores an Anthropic key through the native API', async () => {
    const captured: { request: Request | null } = { request: null };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.request = new Request(input, init);
      return Response.json({ data: [], has_more: false, first_id: null, last_id: null });
    }) as unknown as typeof fetch;
    const response = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'anthropic',
        apiKey: 'sk-ant-secret',
        model: 'claude-haiku-4-5',
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    });
    expect(captured.request?.url).toContain('api.anthropic.com/v1/models');
    expect(captured.request?.headers.get('x-api-key')).toBe('sk-ant-secret');
  });

  test('updates the model without requiring the write-only key again', async () => {
    const first = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openrouter',
        apiKey: 'sk-or-v1-secret',
        model: 'google/gemini-2.5-flash-lite',
      }),
    });
    expect(first.status).toBe(200);
    globalThis.fetch = (async () => {
      throw new Error('model-only updates must not call the provider');
    }) as unknown as typeof fetch;
    const update = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openrouter',
        model: 'deepseek/deepseek-v3.2',
      }),
    });
    expect(update.status).toBe(200);
    expect((await update.json()).model).toBe('deepseek/deepseek-v3.2');
  });

  test('rejects oversized keys before contacting a provider', async () => {
    const response = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'x'.repeat(513) }),
    });
    expect(response.status).toBe(400);
  });

  test('rejects an oversized request before contacting a provider or writing a credential', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new Error('oversized BYOK requests must not contact a provider');
    }) as unknown as typeof fetch;

    const response = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'x'.repeat(17 * 1024) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'BYOK request is too large' });
    expect(fetchCalls).toBe(0);
    expect(
      db.prepare("SELECT 1 FROM user_provider_credentials WHERE userId = 'local'").get(),
    ).toBeNull();
  });
});
