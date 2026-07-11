import '../test-guard';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  makeEntitlements,
  NO_STORAGE_LIMITS,
  setEntitlementsEngineForTests,
  type PlanLimits,
} from '../lib/entitlements';
import { MANAGED_TRANSLATION_MODEL } from '../lib/llm';
import app from './llm-status';

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

afterEach(() => {
  restore?.();
  restore = null;
  globalThis.fetch = originalFetch;
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
