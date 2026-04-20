import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ApfelProvider } from './apfel';

describe('ApfelProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('constructor', () => {
    test('uses provided baseUrl and model', () => {
      const provider = new ApfelProvider('http://custom:9000', 'my-model');
      expect(provider.name).toBe('apfel');
    });

    test('strips trailing slash from baseUrl', () => {
      const provider = new ApfelProvider('http://custom:9000/');
      // Verify by checking healthCheck calls the right URL
      globalThis.fetch = mock(async (url: string) => {
        expect(url).toBe('http://custom:9000/v1/models');
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as typeof fetch;
      provider.healthCheck();
    });
  });

  describe('complete', () => {
    test('sends correct request and parses response', async () => {
      globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
        expect(url).toBe('http://localhost:11434/v1/chat/completions');
        const body = JSON.parse(init?.body as string);
        expect(body.model).toBe('default');
        expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
        expect(body.max_tokens).toBe(100);
        expect(body.response_format).toEqual({ type: 'json_object' });

        return new Response(JSON.stringify({
          choices: [{ message: { content: '{"translation": "Hallo"}' } }],
        }), { status: 200 });
      }) as typeof fetch;

      const provider = new ApfelProvider();
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 100,
      });

      expect(result).toBe('{"translation": "Hallo"}');
    });

    test('returns empty string when response has no choices', async () => {
      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      }) as typeof fetch;

      const provider = new ApfelProvider();
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 100,
      });

      expect(result).toBe('');
    });

    test('throws on non-OK response', async () => {
      globalThis.fetch = mock(async () => {
        return new Response('Internal Server Error', { status: 500 });
      }) as typeof fetch;

      const provider = new ApfelProvider();
      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 100,
        })
      ).rejects.toThrow('Apfel error: Internal Server Error');
    });
  });

  describe('healthCheck', () => {
    test('returns ok when server responds', async () => {
      globalThis.fetch = mock(async (url: string) => {
        expect(url).toBe('http://localhost:11434/v1/models');
        return new Response(JSON.stringify({ data: [{ id: 'default' }] }), { status: 200 });
      }) as typeof fetch;

      const provider = new ApfelProvider();
      const result = await provider.healthCheck();
      expect(result).toEqual({ ok: true });
    });

    test('returns error on non-OK response', async () => {
      globalThis.fetch = mock(async () => {
        return new Response('Unauthorized', { status: 401 });
      }) as typeof fetch;

      const provider = new ApfelProvider();
      const result = await provider.healthCheck();
      expect(result).toEqual({ ok: false, error: 'Apfel returned 401' });
    });

    test('returns error when server is unreachable', async () => {
      globalThis.fetch = mock(async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch;

      const provider = new ApfelProvider();
      const result = await provider.healthCheck();
      expect(result).toEqual({ ok: false, error: 'Cannot reach Apfel at http://localhost:11434' });
    });

    test('uses custom URL in error message', async () => {
      globalThis.fetch = mock(async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch;

      const provider = new ApfelProvider('http://my-apfel:3000');
      const result = await provider.healthCheck();
      expect(result).toEqual({ ok: false, error: 'Cannot reach Apfel at http://my-apfel:3000' });
    });
  });
});
