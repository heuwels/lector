import { describe, test, expect, afterEach, mock } from 'bun:test';
import { LMStudioProvider, LMStudioInvalidResponseIdError } from './lmstudio';

describe('LMStudioProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('constructor', () => {
    test('uses defaults when no options provided', () => {
      const provider = new LMStudioProvider();
      expect(provider.name).toBe('lmstudio');
    });

    test('strips trailing slash from baseUrl', async () => {
      const provider = new LMStudioProvider({ baseUrl: 'http://custom:1234/' });
      globalThis.fetch = mock(async (url: string) => {
        expect(url).toBe('http://custom:1234/v1/models');
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as typeof fetch;
      await provider.healthCheck();
    });

    test('omits Authorization header when no apiKey', async () => {
      const provider = new LMStudioProvider({ baseUrl: 'http://x:1234' });
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBeUndefined();
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as typeof fetch;
      await provider.healthCheck();
    });

    test('sets Authorization header when apiKey provided', async () => {
      const provider = new LMStudioProvider({ baseUrl: 'http://x:1234', apiKey: 'sk-abc' });
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer sk-abc');
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as typeof fetch;
      await provider.healthCheck();
    });
  });

  describe('complete', () => {
    test('sends OpenAI-shaped request to /v1/chat/completions', async () => {
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
      }) as typeof fetch;

      const provider = new LMStudioProvider({ model: 'my-model' });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 50,
      });
      expect(result).toBe('hello back');
    });

    test('returns empty string when response has no choices', async () => {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) as typeof fetch;
      const provider = new LMStudioProvider();
      const result = await provider.complete({ messages: [{ role: 'user', content: 'Hi' }], maxTokens: 10 });
      expect(result).toBe('');
    });

    test('throws on non-OK response', async () => {
      globalThis.fetch = mock(async () => new Response('Bad request', { status: 400 })) as typeof fetch;
      const provider = new LMStudioProvider();
      await expect(
        provider.complete({ messages: [{ role: 'user', content: 'Hi' }], maxTokens: 10 }),
      ).rejects.toThrow('LM Studio error: Bad request');
    });
  });

  describe('chatStateful', () => {
    test('sends input + system_prompt without previous_response_id on first call', async () => {
      globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
        expect(url).toBe('http://localhost:1234/api/v1/chat');
        const body = JSON.parse(init?.body as string);
        expect(body.model).toBe('m');
        expect(body.input).toBe('hello');
        expect(body.system_prompt).toBe('You are a tutor');
        expect(body.previous_response_id).toBeUndefined();
        return new Response(
          JSON.stringify({
            response_id: 'resp_123',
            output: [{ type: 'message', content: 'hi there' }],
          }),
          { status: 200 },
        );
      }) as typeof fetch;

      const provider = new LMStudioProvider({ model: 'm' });
      const result = await provider.chatStateful({ input: 'hello', systemPrompt: 'You are a tutor' });
      expect(result).toEqual({ content: 'hi there', responseId: 'resp_123' });
    });

    test('threads previous_response_id when provided', async () => {
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        expect(body.previous_response_id).toBe('resp_prev');
        return new Response(
          JSON.stringify({
            response_id: 'resp_next',
            output: [{ type: 'message', content: 'continued' }],
          }),
          { status: 200 },
        );
      }) as typeof fetch;

      const provider = new LMStudioProvider({ model: 'm' });
      const result = await provider.chatStateful({ input: 'next', previousResponseId: 'resp_prev' });
      expect(result.responseId).toBe('resp_next');
      expect(result.content).toBe('continued');
    });

    test('throws LMStudioInvalidResponseIdError when previous_response_id is rejected', async () => {
      globalThis.fetch = mock(async () =>
        new Response('previous_response_id not found', { status: 404 }),
      ) as typeof fetch;
      const provider = new LMStudioProvider({ model: 'm' });
      await expect(
        provider.chatStateful({ input: 'x', previousResponseId: 'resp_dead' }),
      ).rejects.toBeInstanceOf(LMStudioInvalidResponseIdError);
    });

    test('does not throw invalid-response-id error when no previousResponseId was sent', async () => {
      globalThis.fetch = mock(async () =>
        new Response('previous_response_id missing', { status: 400 }),
      ) as typeof fetch;
      const provider = new LMStudioProvider({ model: 'm' });
      // No previousResponseId → not the "invalid id" path; surfaces as a generic error
      const err = await provider
        .chatStateful({ input: 'x' })
        .catch((e) => e);
      expect(err).not.toBeInstanceOf(LMStudioInvalidResponseIdError);
      expect(err).toBeInstanceOf(Error);
    });

    test('returns empty content when output has no message-typed entries', async () => {
      globalThis.fetch = mock(async () =>
        new Response(JSON.stringify({ response_id: 'r', output: [{ type: 'tool_call', name: 'x' }] }), {
          status: 200,
        }),
      ) as typeof fetch;
      const provider = new LMStudioProvider({ model: 'm' });
      const result = await provider.chatStateful({ input: 'x' });
      expect(result.content).toBe('');
      expect(result.responseId).toBe('r');
    });
  });

  describe('healthCheck', () => {
    test('returns ok on 200', async () => {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({ data: [{ id: 'm' }] }), { status: 200 })) as typeof fetch;
      const provider = new LMStudioProvider();
      const result = await provider.healthCheck();
      expect(result).toEqual({ ok: true });
    });

    test('returns error on non-OK', async () => {
      globalThis.fetch = mock(async () => new Response('Unauthorized', { status: 401 })) as typeof fetch;
      const provider = new LMStudioProvider();
      const result = await provider.healthCheck();
      expect(result).toEqual({ ok: false, error: 'LM Studio returned 401' });
    });

    test('returns error on unreachable host', async () => {
      globalThis.fetch = mock(async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
      const provider = new LMStudioProvider({ baseUrl: 'http://offline:9999' });
      const result = await provider.healthCheck();
      expect(result).toEqual({ ok: false, error: 'Cannot reach LM Studio at http://offline:9999' });
    });
  });

  describe('listModels', () => {
    test('returns ids from /v1/models data array', async () => {
      globalThis.fetch = mock(async (url: string) => {
        expect(url).toBe('http://localhost:1234/v1/models');
        return new Response(
          JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
          { status: 200 },
        );
      }) as typeof fetch;
      const provider = new LMStudioProvider();
      const ids = await provider.listModels();
      expect(ids).toEqual(['a', 'b', 'c']);
    });

    test('throws on non-OK response', async () => {
      globalThis.fetch = mock(async () => new Response('boom', { status: 500 })) as typeof fetch;
      const provider = new LMStudioProvider();
      await expect(provider.listModels()).rejects.toThrow('LM Studio /v1/models error');
    });
  });

  describe('loadModel', () => {
    test('posts model id to /api/v1/models/load and parses sync response', async () => {
      globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
        expect(url).toBe('http://localhost:1234/api/v1/models/load');
        const body = JSON.parse(init?.body as string);
        expect(body).toEqual({ model: 'org/llm-7b' });
        return new Response(
          JSON.stringify({
            type: 'llm',
            instance_id: 'inst_99',
            load_time_seconds: 4.2,
            status: 'loaded',
          }),
          { status: 200 },
        );
      }) as typeof fetch;

      const provider = new LMStudioProvider();
      const result = await provider.loadModel('org/llm-7b');
      expect(result).toEqual({ ok: true, instanceId: 'inst_99', loadTimeSeconds: 4.2 });
    });

    test('returns error on non-OK response without throwing', async () => {
      globalThis.fetch = mock(async () => new Response('Model not found', { status: 404 })) as typeof fetch;
      const provider = new LMStudioProvider();
      const result = await provider.loadModel('nonexistent');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Model not found');
    });

    test('returns error when network throws', async () => {
      globalThis.fetch = mock(async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
      const provider = new LMStudioProvider();
      const result = await provider.loadModel('anything');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
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
      }) as typeof fetch;

      const provider = new LMStudioProvider({ timeoutMs: 30 });
      await expect(
        provider.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 1 }),
      ).rejects.toThrow();
    });
  });
});
