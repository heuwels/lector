import { describe, test, expect, afterEach, mock } from 'bun:test';
import { OpenAICompatibleProvider } from './openai-compatible';

describe('OpenAICompatibleProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('constructor', () => {
    test('uses defaults when no options provided', () => {
      const provider = new OpenAICompatibleProvider();
      expect(provider.name).toBe('openai');
    });

    test('exposes the configured model', () => {
      const provider = new OpenAICompatibleProvider({ model: 'my-model' });
      expect(provider.model).toBe('my-model');
    });

    test('strips trailing slash from baseUrl', async () => {
      const provider = new OpenAICompatibleProvider({ baseUrl: 'http://custom:9000/' });
      globalThis.fetch = mock(async (url: string) => {
        expect(url).toBe('http://custom:9000/v1/models');
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as unknown as typeof fetch;
      await provider.healthCheck();
    });

    test('omits Authorization header when no apiKey', async () => {
      const provider = new OpenAICompatibleProvider({ baseUrl: 'http://x:1234' });
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBeUndefined();
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as unknown as typeof fetch;
      await provider.healthCheck();
    });

    test('sets Authorization header when apiKey provided', async () => {
      const provider = new OpenAICompatibleProvider({ baseUrl: 'http://x:1234', apiKey: 'sk-abc' });
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer sk-abc');
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as unknown as typeof fetch;
      await provider.healthCheck();
    });
  });

  describe('complete', () => {
    test('sends an OpenAI-shaped request to /v1/chat/completions', async () => {
      globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
        expect(url).toBe('http://localhost:1234/v1/chat/completions');
        const body = JSON.parse(init?.body as string);
        expect(body.model).toBe('my-model');
        expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
        expect(body.max_tokens).toBe(50);
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'hello back' } }] }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;

      const provider = new OpenAICompatibleProvider({ baseUrl: 'http://localhost:1234', model: 'my-model' });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 50,
      });
      expect(result).toBe('hello back');
    });

    test('never sends response_format in text mode', async () => {
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        expect(body.response_format).toBeUndefined();
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
      }) as unknown as typeof fetch;

      const provider = new OpenAICompatibleProvider({ model: 'm' });
      await provider.complete({ messages: [{ role: 'user', content: 'Hi' }], maxTokens: 10 });
    });

    // JSON is prompt-driven, not enforced via response_format: no value works
    // across all backends (LM Studio 400s on json_object; Ollama ignores
    // json_schema), so we never send it and read the text back with parseLooseJson.
    test('does NOT send response_format even when responseFormat is "json"', async () => {
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        expect(body.response_format).toBeUndefined();
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
      }) as unknown as typeof fetch;

      const provider = new OpenAICompatibleProvider({ model: 'm' });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 10,
        responseFormat: 'json',
      });
      expect(result).toBe('{"ok":true}');
    });

    test('returns empty string when response has no choices', async () => {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) as unknown as typeof fetch;
      const provider = new OpenAICompatibleProvider();
      const result = await provider.complete({ messages: [{ role: 'user', content: 'Hi' }], maxTokens: 10 });
      expect(result).toBe('');
    });

    test('throws on non-OK response', async () => {
      globalThis.fetch = mock(async () => new Response('Bad request', { status: 400 })) as unknown as typeof fetch;
      const provider = new OpenAICompatibleProvider();
      await expect(
        provider.complete({ messages: [{ role: 'user', content: 'Hi' }], maxTokens: 10 }),
      ).rejects.toThrow('LLM provider error: Bad request');
    });
  });

  describe('healthCheck', () => {
    test('returns ok on 200', async () => {
      globalThis.fetch = mock(async (url: string) => {
        expect(url).toBe('http://localhost:11434/v1/models');
        return new Response(JSON.stringify({ data: [{ id: 'm' }] }), { status: 200 });
      }) as unknown as typeof fetch;
      const provider = new OpenAICompatibleProvider();
      const result = await provider.healthCheck();
      expect(result).toEqual({ ok: true });
    });

    test('returns error on non-OK', async () => {
      globalThis.fetch = mock(async () => new Response('Unauthorized', { status: 401 })) as unknown as typeof fetch;
      const provider = new OpenAICompatibleProvider();
      const result = await provider.healthCheck();
      expect(result).toEqual({ ok: false, error: 'Provider returned 401' });
    });

    test('returns error on unreachable host', async () => {
      globalThis.fetch = mock(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;
      const provider = new OpenAICompatibleProvider({ baseUrl: 'http://offline:9999' });
      const result = await provider.healthCheck();
      expect(result).toEqual({ ok: false, error: 'Cannot reach LLM provider at http://offline:9999' });
    });
  });

  describe('listModels', () => {
    test('returns ids from /v1/models data array', async () => {
      globalThis.fetch = mock(async (url: string) => {
        expect(url).toBe('http://localhost:11434/v1/models');
        return new Response(
          JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;
      const provider = new OpenAICompatibleProvider();
      const ids = await provider.listModels();
      expect(ids).toEqual(['a', 'b', 'c']);
    });

    test('throws on non-OK response', async () => {
      globalThis.fetch = mock(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
      const provider = new OpenAICompatibleProvider();
      await expect(provider.listModels()).rejects.toThrow('/v1/models error');
    });
  });

  describe('timeout', () => {
    test('aborts when request exceeds timeoutMs', async () => {
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        // Simulate a hanging request that respects the abort signal
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            (err as Error & { name: string }).name = 'AbortError';
            reject(err);
          });
        });
      }) as unknown as typeof fetch;

      const provider = new OpenAICompatibleProvider({ timeoutMs: 30 });
      await expect(
        provider.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 1 }),
      ).rejects.toThrow();
    });
  });
});
