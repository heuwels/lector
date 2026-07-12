import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { LLMTruncatedError } from './errors';
import { completeJson } from './complete-json';

// Intercept the Agent SDK before the provider module binds it, so the tests
// below can assert what query() actually receives (notably options.env — the
// subprocess auth fix for #247). The fake yields a minimal result message.
type QueryArgs = { prompt: string; options: Record<string, unknown> };
const queryCalls: QueryArgs[] = [];
let queryResult: { result?: string; stop_reason?: string | null } = {
  result: 'ok',
  stop_reason: null,
};
mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: QueryArgs) => {
    queryCalls.push(args);
    return (async function* () {
      yield { type: 'result', ...queryResult };
    })();
  },
}));

const { AnthropicProvider } = await import('./anthropic');
const Anthropic = (await import('@anthropic-ai/sdk')).default;

const ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_WORD_MODEL',
  'ANTHROPIC_PHRASE_MODEL',
  'ANTHROPIC_CHAT_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  // Snapshot then clear so each test starts from a known, env-free baseline.
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  queryCalls.length = 0;
  queryResult = { result: 'ok', stop_reason: null };
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('AnthropicProvider model selection', () => {
  test('defaults every task to claude-sonnet-4-6 when nothing is configured', () => {
    const p = new AnthropicProvider({ apiKey: 'test' });
    expect(p.modelForTask()).toBe('claude-sonnet-4-6');
    expect(p.modelForTask('word-gloss')).toBe('claude-sonnet-4-6');
    expect(p.modelForTask('word-enrichment')).toBe('claude-sonnet-4-6');
    expect(p.modelForTask('context-simple')).toBe('claude-sonnet-4-6');
    expect(p.modelForTask('context-rich')).toBe('claude-sonnet-4-6');
    expect(p.modelForTask('phrase-simple')).toBe('claude-sonnet-4-6');
    expect(p.modelForTask('phrase-rich')).toBe('claude-sonnet-4-6');
    expect(p.modelForTask('chat')).toBe('claude-sonnet-4-6');
  });

  test('constructor options select the per-task model', () => {
    const p = new AnthropicProvider({
      apiKey: 'test',
      model: 'claude-sonnet-4-6',
      wordModel: 'claude-haiku-4-5',
      phraseModel: 'claude-opus-4-8',
      chatModel: 'claude-opus-4-8',
    });
    expect(p.modelForTask('word-gloss')).toBe('claude-haiku-4-5');
    expect(p.modelForTask('word-enrichment')).toBe('claude-haiku-4-5');
    expect(p.modelForTask('context-simple')).toBe('claude-haiku-4-5');
    expect(p.modelForTask('context-rich')).toBe('claude-haiku-4-5');
    expect(p.modelForTask('phrase-simple')).toBe('claude-opus-4-8');
    expect(p.modelForTask('phrase-rich')).toBe('claude-opus-4-8');
    expect(p.modelForTask('chat')).toBe('claude-opus-4-8');
    expect(p.modelForTask()).toBe('claude-sonnet-4-6');
  });

  test('per-task env vars override the general default; unset tasks fall back', () => {
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
    process.env.ANTHROPIC_WORD_MODEL = 'claude-haiku-4-5';
    const p = new AnthropicProvider({ apiKey: 'test' });
    expect(p.modelForTask('word-gloss')).toBe('claude-haiku-4-5');
    expect(p.modelForTask('phrase-rich')).toBe('claude-sonnet-4-6');
    expect(p.modelForTask('chat')).toBe('claude-sonnet-4-6');
  });

  test('explicit options beat env vars', () => {
    process.env.ANTHROPIC_WORD_MODEL = 'from-env';
    const p = new AnthropicProvider({ apiKey: 'test', wordModel: 'from-option' });
    expect(p.modelForTask('word-gloss')).toBe('from-option');
  });

  test('an unknown task falls back to the general default', () => {
    const p = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-6' });
    // @ts-expect-error — deliberately exercising the default branch
    expect(p.modelForTask('something-else')).toBe('claude-sonnet-4-6');
  });
});

describe('Agent SDK subprocess auth (#247)', () => {
  // The SDK spawns a Claude Code subprocess that authenticates from its own
  // env — the token the provider resolved must be forwarded explicitly as
  // CLAUDE_CODE_OAUTH_TOKEN or the subprocess reports "Not logged in".

  test('an explicit oauthToken option (the settings-stored path) reaches the subprocess env', async () => {
    const p = new AnthropicProvider({ oauthToken: 'tok-from-settings' });
    await p.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 });

    expect(queryCalls).toHaveLength(1);
    const env = queryCalls[0].options.env as Record<string, string | undefined>;
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok-from-settings');
  });

  test('the documented CLAUDE_OAUTH_TOKEN env var reaches the subprocess env', async () => {
    process.env.CLAUDE_OAUTH_TOKEN = 'tok-from-env';
    const p = new AnthropicProvider();
    await p.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 });

    expect(queryCalls).toHaveLength(1);
    const env = queryCalls[0].options.env as Record<string, string | undefined>;
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok-from-env');
  });

  test('the resolved token wins over a stale CLAUDE_CODE_OAUTH_TOKEN already in process.env', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'stale-ambient-token';
    const p = new AnthropicProvider({ oauthToken: 'tok-resolved' });
    await p.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 });

    const env = queryCalls[0].options.env as Record<string, string | undefined>;
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok-resolved');
  });

  test('subprocess env inherits the rest of process.env alongside the token', async () => {
    process.env.CLAUDE_OAUTH_TOKEN = 'tok';
    const p = new AnthropicProvider();
    await p.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 });

    const env = queryCalls[0].options.env as Record<string, string | undefined>;
    expect(env.PATH).toBe(process.env.PATH); // spread, not replaced
  });

  test('an API key pins the direct-API path — the Agent SDK is never involved', () => {
    // Peeking at the private flag beats calling complete(), which would hit
    // the real API over the network in a unit test.
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test', oauthToken: 'tok-unused' });
    expect((p as unknown as { useAgentSdk: boolean }).useAgentSdk).toBe(false);
  });

  test('surfaces a JSON max_tokens stop as truncation without claiming a larger SDK cap', async () => {
    queryResult = { result: '{"ok":', stop_reason: 'max_tokens' };
    const p = new AnthropicProvider({ oauthToken: 'tok' });

    try {
      await p.complete({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
        responseFormat: 'json-object',
      });
      throw new Error('Expected truncation');
    } catch (error) {
      expect(error).toBeInstanceOf(LLMTruncatedError);
      expect((error as LLMTruncatedError).canIncreaseBudget).toBe(false);
    }
  });
});

describe('Anthropic API truncation metadata', () => {
  test('maps a JSON max_tokens stop to a retryable truncation', async () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' });
    (p as unknown as { client: unknown }).client = {
      messages: {
        create: async () => ({
          content: [{ type: 'text', text: '{"ok":' }],
          stop_reason: 'max_tokens',
        }),
      },
    };

    await expect(
      p.complete({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
        responseFormat: 'json-object',
      }),
    ).rejects.toBeInstanceOf(LLMTruncatedError);
  });

  test('does not turn a truncated text response into a JSON retry signal', async () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' });
    (p as unknown as { client: unknown }).client = {
      messages: {
        create: async () => ({
          content: [{ type: 'text', text: 'partial text' }],
          stop_reason: 'max_tokens',
        }),
      },
    };

    await expect(
      p.complete({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
      }),
    ).resolves.toBe('partial text');
  });

  test('integrates with JSON completion retries at double the API token budget', async () => {
    const budgets: number[] = [];
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' });
    (p as unknown as { client: unknown }).client = {
      messages: {
        create: async (params: { max_tokens: number }) => {
          budgets.push(params.max_tokens);
          const retry = budgets.length === 2;
          return {
            content: [{ type: 'text', text: retry ? '{"ok":true}' : '{"ok":' }],
            stop_reason: retry ? 'end_turn' : 'max_tokens',
          };
        },
      },
    };

    await expect(
      completeJson<{ ok: boolean }>(p, {
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
      }),
    ).resolves.toEqual({ ok: true });
    expect(budgets).toEqual([100, 200]);
  });
});

describe('AnthropicProvider message batches (#226)', () => {
  function injectBatches(
    p: InstanceType<typeof AnthropicProvider>,
    batches: Record<string, unknown>,
  ): void {
    (p as unknown as { client: unknown }).client = { messages: { batches } };
  }

  test('supportsBatch: API-key auth yes, OAuth/Agent-SDK path no', () => {
    expect(new AnthropicProvider({ apiKey: 'sk-ant-test' }).supportsBatch()).toBe(true);
    // OAuth runs through the Agent SDK, which has no batch endpoint.
    expect(new AnthropicProvider({ oauthToken: 'oauth-token' }).supportsBatch()).toBe(false);
  });

  test('createBatch maps requests onto batch params, resolving per-task models', async () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' });
    let captured: unknown;
    injectBatches(p, {
      create: async (params: unknown) => {
        captured = params;
        return { id: 'msgbatch_test' };
      },
    });

    const id = await p.createBatch([
      {
        customId: 'req-0',
        options: {
          messages: [{ role: 'user', content: 'classify these words' }],
          maxTokens: 2048,
          task: 'word-classification',
          responseFormat: 'json-array',
        },
      },
    ]);

    expect(id).toBe('msgbatch_test');
    expect(captured).toEqual({
      requests: [
        {
          custom_id: 'req-0',
          params: {
            // The classification task must resolve to the cheap tier inside
            // batches too — batch pricing halves whatever model runs.
            model: 'claude-haiku-4-5',
            max_tokens: 2048,
            messages: [{ role: 'user', content: 'classify these words' }],
          },
        },
      ],
    });
  });

  test('getBatch reports in_progress until the provider ends the batch', async () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' });
    injectBatches(p, {
      retrieve: async () => ({ processing_status: 'in_progress' }),
      results: async () => {
        throw new Error('results must not be fetched before the batch ends');
      },
    });
    expect(await p.getBatch('msgbatch_test')).toEqual({ state: 'in_progress' });
  });

  test('getBatch collects only succeeded results once ended', async () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' });
    injectBatches(p, {
      retrieve: async () => ({ processing_status: 'ended' }),
      results: async () =>
        (async function* () {
          yield {
            custom_id: 'req-0',
            result: {
              type: 'succeeded',
              message: { content: [{ type: 'text', text: '[{"word":"kos","domain":"food"}]' }] },
            },
          };
          yield { custom_id: 'req-1', result: { type: 'errored', error: { type: 'api_error' } } };
          yield {
            custom_id: 'req-2',
            result: { type: 'succeeded', message: { content: [{ type: 'thinking' }] } },
          };
        })(),
    });

    const status = await p.getBatch('msgbatch_test');
    expect(status.state).toBe('ended');
    if (status.state !== 'ended') throw new Error('unreachable');
    // req-1 errored; req-2 succeeded but had no text block — neither may appear.
    expect([...status.results.entries()]).toEqual([
      ['req-0', '[{"word":"kos","domain":"food"}]'],
    ]);
  });

  test('getBatch maps a batch the provider no longer knows to a terminal failure', async () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' });
    injectBatches(p, {
      retrieve: async () => {
        // instanceof is what the code checks; constructing via prototype skips
        // the version-sensitive APIError constructor signature.
        throw Object.assign(Object.create(Anthropic.NotFoundError.prototype), {
          status: 404,
          message: 'batch not found',
        });
      },
    });

    expect(await p.getBatch('msgbatch_gone')).toEqual({
      state: 'failed',
      error: 'batch msgbatch_gone not found',
    });
  });

  test('transient retrieve errors propagate for the caller to retry', async () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' });
    injectBatches(p, {
      retrieve: async () => {
        throw new Error('ECONNRESET');
      },
    });
    await expect(p.getBatch('msgbatch_test')).rejects.toThrow('ECONNRESET');
  });
});
