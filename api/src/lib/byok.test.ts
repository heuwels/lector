import '../test-guard';
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { randomBytes } from 'crypto';
import { db } from '../db';
import {
  BYOK_CATALOG,
  decryptCredential,
  deleteByokCredential,
  encryptCredential,
  getByokCredential,
  hasByokCredential,
  isByokAvailable,
  OPENROUTER_URL,
  saveByokCredential,
} from './byok';
import { getClassificationProvider, getProvider, resetProvider } from './llm';
import { LOCAL_USER_ID } from './user';

const previousKey = process.env.BYOK_ENCRYPTION_KEY;
const previousClassifyUrl = process.env.CLASSIFY_LLM_URL;
const previousClassifyModel = process.env.CLASSIFY_LLM_MODEL;
const previousClassifyKey = process.env.CLASSIFY_LLM_API_KEY;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.BYOK_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  db.prepare("DELETE FROM user_provider_credentials WHERE userId LIKE 'byok-test-%'").run();
});

afterAll(() => {
  if (previousKey === undefined) delete process.env.BYOK_ENCRYPTION_KEY;
  else process.env.BYOK_ENCRYPTION_KEY = previousKey;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (previousClassifyUrl === undefined) delete process.env.CLASSIFY_LLM_URL;
  else process.env.CLASSIFY_LLM_URL = previousClassifyUrl;
  if (previousClassifyModel === undefined) delete process.env.CLASSIFY_LLM_MODEL;
  else process.env.CLASSIFY_LLM_MODEL = previousClassifyModel;
  if (previousClassifyKey === undefined) delete process.env.CLASSIFY_LLM_API_KEY;
  else process.env.CLASSIFY_LLM_API_KEY = previousClassifyKey;
});

describe('BYOK encryption', () => {
  test('round-trips with tenant/provider-bound authenticated encryption', () => {
    const encrypted = encryptCredential('byok-test-a', 'openrouter', 'sk-secret');
    expect(encrypted).not.toContain('sk-secret');
    expect(decryptCredential('byok-test-a', 'openrouter', encrypted)).toBe('sk-secret');
    expect(() => decryptCredential('byok-test-b', 'openrouter', encrypted)).toThrow();
  });

  test('rejects absent and malformed encryption keys', () => {
    delete process.env.BYOK_ENCRYPTION_KEY;
    expect(isByokAvailable()).toBe(false);
    expect(() => encryptCredential('byok-test-a', 'openrouter', 'secret')).toThrow();
    process.env.BYOK_ENCRYPTION_KEY = Buffer.from('short').toString('base64');
    expect(isByokAvailable()).toBe(false);
  });
});

describe('per-user credential storage and routing', () => {
  test('OpenRouter catalog carries the evaluated models in leaderboard order', () => {
    expect(BYOK_CATALOG.openrouter.models.slice(1).map((model) => model.id)).toEqual([
      'openai/gpt-5',
      'google/gemini-2.5-pro',
      'anthropic/claude-opus-4.8',
      'anthropic/claude-sonnet-4.6',
      'openai/gpt-4o-mini',
      'openai/gpt-4o',
      'mistralai/mistral-large',
      'meta-llama/llama-3.3-70b-instruct',
      'google/gemini-2.5-flash',
      'deepseek/deepseek-v3.2',
      'google/gemma-2-27b-it',
      'google/gemma-3-27b-it',
      'anthropic/claude-haiku-4.5',
      'mistralai/mistral-small-3.2-24b-instruct',
    ]);
  });

  test('stores no plaintext and isolates accounts', () => {
    saveByokCredential('byok-test-a', 'openrouter', 'sk-user-a', 'model-a');
    const stored = db
      .prepare('SELECT ciphertext FROM user_provider_credentials WHERE userId = ? AND provider = ?')
      .get('byok-test-a', 'openrouter') as { ciphertext: string };

    expect(stored.ciphertext).not.toContain('sk-user-a');
    expect(getByokCredential('byok-test-a')?.apiKey).toBe('sk-user-a');
    expect(getByokCredential('byok-test-b')).toBeNull();
    expect(hasByokCredential('byok-test-a')).toBe(true);
    expect(hasByokCredential('byok-test-b')).toBe(false);
  });

  test('selects the account model and falls back after disable', () => {
    saveByokCredential('byok-test-a', 'openrouter', 'sk-user-a', 'model-a');
    expect(getProvider('byok-test-a', { byok: true }).model).toBe('model-a');
    deleteByokCredential('byok-test-a');
    expect(hasByokCredential('byok-test-a')).toBe(false);
    expect(getByokCredential('byok-test-a')).toBeNull();
    expect(getProvider('byok-test-a', { byok: false }).model).not.toBe('model-a');
  });

  test('never replaces a BYOK model with a managed cheap-task override', async () => {
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    saveByokCredential('byok-test-a', 'openrouter', 'sk-user-a', 'openai/gpt-4o-mini');
    await getProvider('byok-test-a', { byok: true }).complete({
      messages: [{ role: 'user', content: 'Translate' }],
      maxTokens: 32,
      task: 'word-gloss',
    });

    expect(body?.model).toBe('openai/gpt-4o-mini');
    expect(body?.reasoning).toBeUndefined();
  });

  test('hosted Free ignores stale local provider settings and keeps managed tasks pinned', async () => {
    const envKeys = [
      'LECTOR_MODE',
      'LECTOR_FREE_TIER',
      'LLM_PROVIDER',
      'OPENAI_COMPAT_URL',
      'OPENAI_COMPAT_MODEL',
      'OPENAI_COMPAT_API_KEY',
      'OPENAI_COMPAT_WORD_GLOSS_MODEL',
      'OPENAI_COMPAT_SIMPLE_PHRASE_MODEL',
      'OPENAI_COMPAT_SIMPLE_CONTEXT_MODEL',
    ] as const;
    const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
    const settingKeys = [
      'llmProvider',
      'openaiUrl',
      'openaiModel',
      'openaiApiKey',
      'anthropicApiKey',
    ];
    const previousSettings = db
      .prepare(
        `SELECT key, value FROM settings
         WHERE userId = ? AND key IN (${settingKeys.map(() => '?').join(', ')})`,
      )
      .all(LOCAL_USER_ID, ...settingKeys) as Array<{ key: string; value: string }>;

    try {
      process.env.LECTOR_MODE = 'cloud';
      process.env.LECTOR_FREE_TIER = 'true';
      process.env.LLM_PROVIDER = 'openai';
      process.env.OPENAI_COMPAT_URL = OPENROUTER_URL;
      process.env.OPENAI_COMPAT_MODEL = 'openai/gpt-5';
      process.env.OPENAI_COMPAT_API_KEY = 'sk-env-managed';
      process.env.OPENAI_COMPAT_WORD_GLOSS_MODEL = 'google/gemini-2.5-flash-lite';
      process.env.OPENAI_COMPAT_SIMPLE_PHRASE_MODEL = 'google/gemini-2.5-flash-lite';
      process.env.OPENAI_COMPAT_SIMPLE_CONTEXT_MODEL = 'google/gemini-2.5-flash-lite';

      const putSetting = db.prepare(
        'INSERT OR REPLACE INTO settings (userId, key, value) VALUES (?, ?, ?)',
      );
      putSetting.run(LOCAL_USER_ID, 'llmProvider', JSON.stringify('anthropic'));
      putSetting.run(LOCAL_USER_ID, 'openaiUrl', JSON.stringify('https://stale.invalid/api'));
      putSetting.run(LOCAL_USER_ID, 'openaiModel', JSON.stringify('openai/gpt-5'));
      putSetting.run(LOCAL_USER_ID, 'openaiApiKey', JSON.stringify('sk-stale-local'));
      putSetting.run(LOCAL_USER_ID, 'anthropicApiKey', JSON.stringify('sk-ant-stale-local'));

      const requests: Array<{
        url: string;
        authorization?: string;
        body: Record<string, unknown>;
      }> = [];
      globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        requests.push({
          url: String(url),
          authorization: headers.Authorization,
          body: JSON.parse(init?.body as string),
        });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
        });
      }) as unknown as typeof fetch;

      resetProvider();
      const provider = getProvider('byok-test-managed', { byok: false });
      expect(provider.name).toBe('openai');
      for (const task of ['word-gloss', 'phrase-simple', 'context-simple'] as const) {
        await provider.complete({
          messages: [{ role: 'user', content: 'Translate' }],
          maxTokens: 48,
          task,
        });
      }

      expect(requests).toHaveLength(3);
      expect(
        requests.every((request) => request.url === `${OPENROUTER_URL}/v1/chat/completions`),
      ).toBe(true);
      expect(requests.every((request) => request.authorization === 'Bearer sk-env-managed')).toBe(
        true,
      );
      expect(requests.map((request) => request.body.model)).toEqual([
        'google/gemini-2.5-flash-lite',
        'google/gemini-2.5-flash-lite',
        'google/gemini-2.5-flash-lite',
      ]);
    } finally {
      resetProvider();
      db.prepare(
        `DELETE FROM settings
         WHERE userId = ? AND key IN (${settingKeys.map(() => '?').join(', ')})`,
      ).run(LOCAL_USER_ID, ...settingKeys);
      const restoreSetting = db.prepare(
        'INSERT INTO settings (userId, key, value) VALUES (?, ?, ?)',
      );
      for (const row of previousSettings) restoreSetting.run(LOCAL_USER_ID, row.key, row.value);
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('uses OpenRouter JSON mode for every model and GPT-5 reasoning only where needed', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: '{"translation":"ok"}' } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    saveByokCredential('byok-test-a', 'openrouter', 'sk-user-a', 'openai/gpt-5');
    await getProvider('byok-test-a', { byok: true }).complete({
      messages: [{ role: 'user', content: 'Translate' }],
      maxTokens: 100,
      responseFormat: 'json-object',
      task: 'phrase-rich',
    });

    saveByokCredential('byok-test-b', 'openrouter', 'sk-user-b', 'google/gemini-2.5-flash-lite');
    await getProvider('byok-test-b', { byok: true }).complete({
      messages: [{ role: 'user', content: 'Translate' }],
      maxTokens: 100,
      responseFormat: 'json-object',
    });

    expect(bodies[0]).toMatchObject({
      model: 'openai/gpt-5',
      max_completion_tokens: 100,
      response_format: { type: 'json_object' },
      provider: { require_parameters: true },
      reasoning: { effort: 'minimal' },
    });
    expect(bodies[0].max_tokens).toBeUndefined();
    expect(bodies[1]).toMatchObject({
      model: 'google/gemini-2.5-flash-lite',
      max_tokens: 100,
      response_format: { type: 'json_object' },
      provider: { require_parameters: true },
    });
    expect(bodies[1].max_completion_tokens).toBeUndefined();
    expect(bodies[1].reasoning).toBeUndefined();
  });

  test('profiles a dedicated OpenRouter classifier without forcing object JSON', async () => {
    process.env.CLASSIFY_LLM_URL = OPENROUTER_URL;
    process.env.CLASSIFY_LLM_MODEL = 'openai/gpt-5';
    process.env.CLASSIFY_LLM_API_KEY = 'sk-classifier';
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '[]' } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await getClassificationProvider().complete({
      messages: [{ role: 'user', content: 'Classify' }],
      maxTokens: 100,
      responseFormat: 'json-array',
      task: 'word-classification',
    });

    expect(body).toMatchObject({ model: 'openai/gpt-5', max_completion_tokens: 100 });
    expect(body?.max_tokens).toBeUndefined();
    expect(body?.response_format).toBeUndefined();
    expect(body?.provider).toBeUndefined();
  });

  test('routes an Anthropic key through the native Anthropic provider', () => {
    saveByokCredential('byok-test-a', 'anthropic', 'sk-ant-test', 'claude-haiku-4-5');
    const credential = getByokCredential('byok-test-a');
    expect(credential?.provider).toBe('anthropic');
    expect(getProvider('byok-test-a', { byok: true }).name).toBe('anthropic');
    expect(getProvider('byok-test-a', { byok: true }).model).toBe('claude-haiku-4-5');
  });

  test('switching providers removes the previous active credential', () => {
    saveByokCredential('byok-test-a', 'openrouter', 'sk-or-test', 'model-a');
    saveByokCredential('byok-test-a', 'anthropic', 'sk-ant-test', 'claude-haiku-4-5');
    const rows = db
      .prepare('SELECT provider FROM user_provider_credentials WHERE userId = ?')
      .all('byok-test-a') as Array<{ provider: string }>;
    expect(rows).toEqual([{ provider: 'anthropic' }]);
  });

  test('an unreadable credential falls back to managed AI and removes BYOK entitlement', () => {
    saveByokCredential('byok-test-a', 'openrouter', 'sk-user-a', 'model-a');
    process.env.BYOK_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    expect(getByokCredential('byok-test-a')).toBeNull();
    expect(hasByokCredential('byok-test-a')).toBe(false);
    expect(() => getProvider('byok-test-a', { byok: true })).toThrow(
      /BYOK credential is no longer available/,
    );
    expect(() => getProvider('byok-test-a', { byok: false })).not.toThrow();
  });

  test('provider access cannot switch billing source after the entitlement decision', () => {
    saveByokCredential('byok-test-a', 'openrouter', 'sk-user-a', 'model-a');
    deleteByokCredential('byok-test-a');
    expect(() => getProvider('byok-test-a', { byok: true })).toThrow(
      /BYOK credential is no longer available/,
    );

    // The inverse race is safe too: a request reserved against managed quota
    // ignores a key added before provider construction.
    saveByokCredential('byok-test-b', 'openrouter', 'sk-user-b', 'model-b');
    expect(getProvider('byok-test-b', { byok: false }).model).not.toBe('model-b');
  });
});
