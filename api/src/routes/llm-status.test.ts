import '../test-guard';
import { afterEach, describe, expect, test } from 'bun:test';
import { db } from '../db';
import {
  makeEntitlements,
  NO_STORAGE_LIMITS,
  setEntitlementsEngineForTests,
  type PlanLimits,
} from '../lib/entitlements';
import {
  MANAGED_TRANSLATION_MODEL,
  type CompletionOptions,
  type LLMProvider,
  type ProviderAccessOptions,
} from '../lib/llm';
import app, { makeLlmStatusRoutes } from './llm-status';

const originalFetch = globalThis.fetch;
let restore: (() => void) | null = null;

const FREE_LIMITS: PlanLimits = {
  ...NO_STORAGE_LIMITS,
  phraseSelectionWords: 6,
  journalWordsPerMonth: 1_000,
  maxCollections: 10,
  maxLessons: 200,
  llmRequestsPerMonth: 0,
  ttsCharsPerMonth: 0,
  wordGlossesPerMonth: 1_000,
  phraseTranslationsPerDay: 10,
  contextTranslationsPerDay: 10,
};

function installFreeEngine() {
  restore = setEntitlementsEngineForTests(
    makeEntitlements({
      enforced: true,
      freeTierEnabled: true,
      exemptEmails: new Set(),
      prices: [],
      planLimits: { free: FREE_LIMITS, cloud: FREE_LIMITS, plus: FREE_LIMITS },
      resolveEmail: () => null,
      isByok: () => false,
      compedPlan: () => null,
      now: () => new Date('2026-07-11T12:00:00Z'),
    }),
  );
}

function paidEngine(limit = 2) {
  const paid = { ...FREE_LIMITS, llmRequestsPerMonth: limit };
  return makeEntitlements({
    enforced: true,
    freeTierEnabled: true,
    exemptEmails: new Set(),
    prices: [],
    planLimits: { free: FREE_LIMITS, cloud: paid, plus: paid },
    resolveEmail: () => null,
    isByok: () => false,
    compedPlan: () => 'cloud',
    now: () => new Date('2026-07-11T12:00:00Z'),
  });
}

class FakeProvider implements LLMProvider {
  name = 'fake-provider';
  model = 'fake-model';
  completions: CompletionOptions[] = [];
  completeImpl: (options: CompletionOptions) => Promise<string> = async () => '{"ok":true}';
  health = { ok: true as boolean, error: undefined as string | undefined };

  async complete(options: CompletionOptions) {
    this.completions.push(options);
    return this.completeImpl(options);
  }

  async *stream(): AsyncGenerator<string> {
    yield '';
  }

  async healthCheck() {
    return this.health;
  }
}

function appWithProvider(
  engine: ReturnType<typeof paidEngine>,
  provider: FakeProvider,
  onAccess: (userId: string, access: ProviderAccessOptions) => void = () => {},
  resetProviderCache: () => void = () => {},
) {
  return makeLlmStatusRoutes({
    engine,
    providerForUser(userId, access) {
      onAccess(userId, access);
      return provider;
    },
    resetProviderCache,
  });
}

afterEach(() => {
  restore?.();
  restore = null;
  globalThis.fetch = originalFetch;
  db.prepare("DELETE FROM usage_counters WHERE userId = 'local'").run();
});

describe('Free managed LLM status', () => {
  test('reports the boot-pinned translation provider without an upstream health request', async () => {
    installFreeEngine();
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new Error('managed Free status must not proxy an unmetered health request');
    }) as unknown as typeof fetch;

    const response = await app.request('/');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      provider: 'openai',
      model: MANAGED_TRANSLATION_MODEL,
      ok: true,
    });
    expect(fetchCalls).toBe(0);
  });

  test('does not let Free reset the process-global provider cache', async () => {
    installFreeEngine();
    expect((await app.request('/reset', { method: 'POST' })).status).toBe(200);
  });
});

describe('paid and BYOK-capable LLM status paths', () => {
  test('GET reports fake provider health without making a real network request', async () => {
    const provider = new FakeProvider();
    provider.health = { ok: false, error: 'provider unavailable' };
    const access: Array<{ userId: string; byok: boolean }> = [];
    const statusApp = appWithProvider(paidEngine(), provider, (userId, mode) => {
      access.push({ userId, byok: mode.byok });
    });

    const response = await statusApp.request('/');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      provider: 'fake-provider',
      model: 'fake-model',
      ok: false,
      error: 'provider unavailable',
    });
    expect(access).toEqual([{ userId: 'local', byok: false }]);
  });

  test('POST /test reserves once and sends the bounded health prompt to the fake provider', async () => {
    const engine = paidEngine();
    const provider = new FakeProvider();
    const statusApp = appWithProvider(engine, provider);

    const response = await statusApp.request('/test', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, response: '{"ok":true}' });
    expect(provider.completions).toEqual([
      {
        messages: [{ role: 'user', content: 'Respond with exactly: {"ok":true}' }],
        maxTokens: 32,
      },
    ]);
    expect(engine.getUsage('local', 'llmRequestsPerMonth')).toBe(1);
  });

  test('POST /test refunds its reservation when provider construction or completion fails', async () => {
    const engine = paidEngine();
    const provider = new FakeProvider();
    provider.completeImpl = async () => {
      throw new Error('upstream failed');
    };
    const statusApp = appWithProvider(engine, provider);

    const response = await statusApp.request('/test', { method: 'POST' });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'upstream failed' });
    expect(engine.getUsage('local', 'llmRequestsPerMonth')).toBe(0);
  });

  test('POST /reset clears the cache for paid plans', async () => {
    let resets = 0;
    const statusApp = appWithProvider(
      paidEngine(),
      new FakeProvider(),
      () => {},
      () => {
        resets += 1;
      },
    );

    expect((await statusApp.request('/reset', { method: 'POST' })).status).toBe(200);
    expect(resets).toBe(1);
  });
});
