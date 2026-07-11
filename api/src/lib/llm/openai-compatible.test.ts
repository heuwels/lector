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

    test('keeps JSON mode and reasoning off for GPT-5 text completions', async () => {
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        expect(body.response_format).toBeUndefined();
        expect(body.reasoning).toBeUndefined();
        expect(body.max_completion_tokens).toBe(10);
        expect(body.max_tokens).toBeUndefined();
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
      }) as unknown as typeof fetch;

      const provider = new OpenAICompatibleProvider({ model: 'openai/gpt-5', profile: 'openrouter-gpt5' });
      await provider.complete({ messages: [{ role: 'user', content: 'Hi' }], maxTokens: 10 });
    });

    // Generic JSON remains prompt-driven: LM Studio rejects json_object and
    // Ollama ignores json_schema, so only verified profiles opt into JSON mode.
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

    test('keeps default reasoning for non-phrase GPT-5 JSON tasks', async () => {
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.reasoning).toBeUndefined();
        return new Response(
          JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;

      const provider = new OpenAICompatibleProvider({ model: 'openai/gpt-5', profile: 'openrouter-gpt5' });
      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 10,
        responseFormat: 'json',
        task: 'word-translation',
      });
    });

    test('uses GPT-5 structured-output fields for OpenRouter JSON', async () => {
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.reasoning).toEqual({ effort: 'minimal' });
        expect(body.max_completion_tokens).toBe(10);
        expect(body.max_tokens).toBeUndefined();
        return new Response(
          JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;

      const provider = new OpenAICompatibleProvider({ model: 'openai/gpt-5', profile: 'openrouter-gpt5' });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 10,
        responseFormat: 'json',
        task: 'phrase-translation',
      });
      expect(result).toBe('{"ok":true}');
    });

    test('retries a length-limited GPT-5 JSON completion with double the token budget', async () => {
      const budgets: number[] = [];
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        budgets.push(body.max_completion_tokens);
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.reasoning).toEqual({ effort: 'minimal' });
        const retry = budgets.length === 2;
        return new Response(
          JSON.stringify({
            choices: [{
              finish_reason: retry ? 'stop' : 'length',
              message: { content: retry ? '{"ok":true}' : '{"ok":' },
            }],
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;

      const provider = new OpenAICompatibleProvider({ model: 'openai/gpt-5', profile: 'openrouter-gpt5' });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 10,
        responseFormat: 'json',
        task: 'phrase-translation',
      });

      expect(result).toBe('{"ok":true}');
      expect(budgets).toEqual([10, 20]);
    });

    test('throws a specific error when the GPT-5 JSON retry is also length-limited', async () => {
      globalThis.fetch = mock(async () => new Response(
        JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"ok":' } }] }),
        { status: 200 },
      )) as unknown as typeof fetch;

      const provider = new OpenAICompatibleProvider({ model: 'openai/gpt-5', profile: 'openrouter-gpt5' });
      await expect(provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 10,
        responseFormat: 'json',
        task: 'phrase-translation',
      })).rejects.toThrow('LLM response was truncated after retrying with a 20-token limit');
    });

    test('does not retry length-limited JSON on a generic backend', async () => {
      let calls = 0;
      globalThis.fetch = mock(async () => {
        calls += 1;
        return new Response(
          JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"ok":' } }] }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;

      const provider = new OpenAICompatibleProvider({ model: 'local-model' });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 10,
        responseFormat: 'json',
      });

      expect(result).toBe('{"ok":');
      expect(calls).toBe(1);
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
