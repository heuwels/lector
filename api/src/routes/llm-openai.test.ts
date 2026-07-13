import '../test-guard';
import { afterEach, describe, expect, test } from 'bun:test';
import { db } from '../db';
import { makeLlmOpenaiRoutes } from './llm-openai';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  db.prepare(
    "DELETE FROM settings WHERE key = 'openaiApiKey' AND userId LIKE 'llm-openai-%'",
  ).run();
  db.prepare("DELETE FROM settings WHERE key = 'openaiApiKey' AND userId = 'local'").run();
});

describe('OpenAI-compatible model discovery route', () => {
  test('is hidden in built-in-auth cloud before parsing or making an outbound request', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new Error('cloud model discovery must not fetch');
    }) as unknown as typeof fetch;

    const app = makeLlmOpenaiRoutes('cloud');
    const response = await app.request('/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Deliberately malformed: the deployment check must run before parsing.
      body: '{',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
    expect(fetchCalls).toBe(0);
  });

  test('keeps selfhost model discovery and caller-supplied credentials working', async () => {
    const captured: { request: Request | null } = { request: null };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.request = new Request(input, init);
      return Response.json({ data: [{ id: 'local-a' }, { id: 'local-b' }] });
    }) as unknown as typeof fetch;

    const app = makeLlmOpenaiRoutes('selfhost');
    const response = await app.request('/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'http://127.0.0.1:11434/',
        apiKey: 'local-secret',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ['local-a', 'local-b'] });
    expect(captured.request?.url).toBe('http://127.0.0.1:11434/v1/models');
    expect(captured.request?.headers.get('Authorization')).toBe('Bearer local-secret');
  });

  test('rejects malformed JSON and a missing endpoint before fetching', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('invalid input must not fetch');
    }) as unknown as typeof fetch;
    const app = makeLlmOpenaiRoutes('selfhost');

    const malformed = await app.request('/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid JSON body' });

    const missing = await app.request('/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'endpoint is required' });
    expect(fetchCalls).toBe(0);
  });

  test('maps an upstream model-list failure to 502', async () => {
    globalThis.fetch = (async () =>
      new Response('denied', { status: 401 })) as unknown as typeof fetch;
    const app = makeLlmOpenaiRoutes('selfhost');

    const response = await app.request('/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'http://127.0.0.1:11434' }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: '/v1/models error: denied' });
  });

  test('uses only the current tenant saved credential when the body omits a key', async () => {
    db.prepare('INSERT INTO settings (userId, key, value) VALUES (?, ?, ?)').run(
      'local',
      'openaiApiKey',
      '"saved-local-key"',
    );
    db.prepare('INSERT INTO settings (userId, key, value) VALUES (?, ?, ?)').run(
      'llm-openai-intruder',
      'openaiApiKey',
      '"intruder-key"',
    );
    const captured: { authorization: string | null } = { authorization: null };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.authorization = new Request(input, init).headers.get('Authorization');
      return Response.json({ data: [] });
    }) as unknown as typeof fetch;
    const app = makeLlmOpenaiRoutes('selfhost');

    const response = await app.request('/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'http://127.0.0.1:11434' }),
    });

    expect(response.status).toBe(200);
    expect(captured.authorization).toBe('Bearer saved-local-key');
  });
});
