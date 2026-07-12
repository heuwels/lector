import '../test-guard';
import { afterAll, describe, expect, test } from 'bun:test';
import { makeLlmOpenaiRoutes } from './llm-openai';

const originalFetch = globalThis.fetch;

afterAll(() => {
  globalThis.fetch = originalFetch;
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
});
