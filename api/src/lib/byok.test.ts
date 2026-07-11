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
  saveByokCredential,
} from './byok';
import { getProvider } from './llm';

const previousKey = process.env.BYOK_ENCRYPTION_KEY;
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
    expect(getProvider('byok-test-a').model).toBe('model-a');
    deleteByokCredential('byok-test-a');
    expect(hasByokCredential('byok-test-a')).toBe(false);
    expect(getByokCredential('byok-test-a')).toBeNull();
    expect(getProvider('byok-test-a').model).not.toBe('model-a');
  });

  test('enables structured output only for the OpenRouter GPT-5 profile', async () => {
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
    await getProvider('byok-test-a').complete({
      messages: [{ role: 'user', content: 'Translate' }],
      maxTokens: 100,
      responseFormat: 'json',
      task: 'phrase-translation',
    });

    saveByokCredential('byok-test-b', 'openrouter', 'sk-user-b', 'google/gemini-2.5-flash-lite');
    await getProvider('byok-test-b').complete({
      messages: [{ role: 'user', content: 'Translate' }],
      maxTokens: 100,
      responseFormat: 'json',
    });

    expect(bodies[0]).toMatchObject({
      model: 'openai/gpt-5',
      max_completion_tokens: 100,
      response_format: { type: 'json_object' },
      reasoning: { effort: 'minimal' },
    });
    expect(bodies[0].max_tokens).toBeUndefined();
    expect(bodies[1]).toMatchObject({
      model: 'google/gemini-2.5-flash-lite',
      max_tokens: 100,
    });
    expect(bodies[1].max_completion_tokens).toBeUndefined();
    expect(bodies[1].response_format).toBeUndefined();
    expect(bodies[1].reasoning).toBeUndefined();
  });

  test('routes an Anthropic key through the native Anthropic provider', () => {
    saveByokCredential('byok-test-a', 'anthropic', 'sk-ant-test', 'claude-haiku-4-5');
    const credential = getByokCredential('byok-test-a');
    expect(credential?.provider).toBe('anthropic');
    expect(getProvider('byok-test-a').name).toBe('anthropic');
    expect(getProvider('byok-test-a').model).toBe('claude-haiku-4-5');
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
    expect(() => getProvider('byok-test-a')).not.toThrow();
  });
});
