import { describe, test, expect } from 'bun:test';
import { classifyWords, type ClassifyItem } from './word-classifier';
import type { LLMProvider, CompletionOptions } from './llm/types';
import { LLMTruncatedError } from './llm/errors';

/** A provider that returns a canned string and records how it was called. */
function mockProvider(response: string): LLMProvider & { calls: CompletionOptions[] } {
  const calls: CompletionOptions[] = [];
  return {
    name: 'mock',
    calls,
    async complete(options: CompletionOptions) {
      calls.push(options);
      return response;
    },
    // The classifier only ever calls complete(); stream() exists solely to
    // satisfy the LLMProvider interface (master added it for the gloss path).
    stream(): AsyncIterable<string> {
      throw new Error('mockProvider.stream() is not used by the word classifier');
    },
    async healthCheck() {
      return { ok: true };
    },
  };
}

const ITEMS: ClassifyItem[] = [
  { word: 'koffie', translation: 'coffee' },
  {
    word: 'longontsteking',
    translation: 'pneumonia',
    sentence: 'Hy is met longontsteking hospitaal toe.',
  },
  { word: 'die', translation: 'the' },
];

describe('classifyWords', () => {
  test('parses a valid batch into per-word domains', async () => {
    const provider = mockProvider(
      JSON.stringify([
        { word: 'koffie', domain: 'food' },
        { word: 'longontsteking', domain: 'health' },
        { word: 'die', domain: 'general' },
      ]),
    );
    const result = await classifyWords(ITEMS, provider);
    expect(result).toEqual([
      { word: 'koffie', domain: 'food' },
      { word: 'longontsteking', domain: 'health' },
      { word: 'die', domain: 'general' },
    ]);
  });

  test('passes the word-classification task and json hint to the provider', async () => {
    const provider = mockProvider('[]');
    await classifyWords(ITEMS, provider);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].task).toBe('word-classification');
    expect(provider.calls[0].responseFormat).toBe('json-array');
    // The prompt is built from the taxonomy + the input words.
    const prompt = provider.calls[0].messages[0].content;
    expect(prompt).toContain('koffie');
    expect(prompt).toContain('science_tech'); // a domain key from DOMAINS
    expect(prompt).toContain('general');
  });

  test('returns [] for an empty batch without calling the provider', async () => {
    const provider = mockProvider('should not be used');
    const result = await classifyWords([], provider);
    expect(result).toEqual([]);
    expect(provider.calls).toHaveLength(0);
  });

  test('drops words tagged with an out-of-enum domain, keeps the valid ones', async () => {
    const provider = mockProvider(
      JSON.stringify([
        { word: 'koffie', domain: 'food' },
        { word: 'longontsteking', domain: 'medicine' }, // not a taxonomy key
        { word: 'die', domain: 'general' },
      ]),
    );
    const result = await classifyWords(ITEMS, provider);
    expect(result).toEqual([
      { word: 'koffie', domain: 'food' },
      { word: 'die', domain: 'general' },
    ]);
  });

  test('strips a <think> reasoning block before the JSON (LM Studio reasoning models)', async () => {
    const provider = mockProvider(
      `<think>koffie is a drink {food?}; longontsteking is a lung illness</think>\n` +
        JSON.stringify([
          { word: 'koffie', domain: 'food' },
          { word: 'longontsteking', domain: 'health' },
        ]),
    );
    const result = await classifyWords(ITEMS, provider);
    expect(result).toEqual([
      { word: 'koffie', domain: 'food' },
      { word: 'longontsteking', domain: 'health' },
    ]);
  });

  test('parses JSON wrapped in a ```json markdown fence', async () => {
    const provider = mockProvider('```json\n[{"word":"koffie","domain":"food"}]\n```');
    const result = await classifyWords([{ word: 'koffie' }], provider);
    expect(result).toEqual([{ word: 'koffie', domain: 'food' }]);
  });

  test('returns [] when the model emits no usable JSON at all', async () => {
    const provider = mockProvider('I cannot classify these words, sorry!');
    const result = await classifyWords(ITEMS, provider);
    expect(result).toEqual([]);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].messages[0].content).toContain(
      'previous response could not be parsed',
    );
  });

  test('propagates provider failures to the worker error boundary', async () => {
    const provider = mockProvider('[]');
    provider.complete = async () => {
      throw new Error('provider unavailable');
    };

    await expect(classifyWords(ITEMS, provider)).rejects.toThrow('provider unavailable');
  });

  test('caps a truncation retry at the classifier output ceiling', async () => {
    const calls: CompletionOptions[] = [];
    const provider: LLMProvider = {
      ...mockProvider('[]'),
      async complete(options) {
        calls.push(options);
        if (calls.length === 1) throw new LLMTruncatedError(options.maxTokens);
        return '[]';
      },
    };
    const previousMaxTokens = process.env.CLASSIFY_MAX_TOKENS;
    process.env.CLASSIFY_MAX_TOKENS = '8192';
    try {
      await classifyWords(ITEMS, provider);
    } finally {
      if (previousMaxTokens === undefined) delete process.env.CLASSIFY_MAX_TOKENS;
      else process.env.CLASSIFY_MAX_TOKENS = previousMaxTokens;
    }
    expect(calls.map((call) => call.maxTokens)).toEqual([8192, 8192]);
  });

  test('ignores hallucinated words not present in the input batch', async () => {
    const provider = mockProvider(
      JSON.stringify([
        { word: 'koffie', domain: 'food' },
        { word: 'banana', domain: 'food' }, // never asked about
      ]),
    );
    const result = await classifyWords(ITEMS, provider);
    expect(result).toEqual([{ word: 'koffie', domain: 'food' }]);
  });

  test('matches the input spelling even when the model re-cases the word', async () => {
    const provider = mockProvider(JSON.stringify([{ word: 'KOFFIE', domain: 'food' }]));
    const result = await classifyWords([{ word: 'koffie' }], provider);
    // Result carries the exact input spelling so the worker's UPDATE matches.
    expect(result).toEqual([{ word: 'koffie', domain: 'food' }]);
  });

  test('normalises a spaced domain label back to its key', async () => {
    const provider = mockProvider(JSON.stringify([{ word: 'rekenaar', domain: 'science tech' }]));
    const result = await classifyWords([{ word: 'rekenaar', translation: 'computer' }], provider);
    expect(result).toEqual([{ word: 'rekenaar', domain: 'science_tech' }]);
  });

  test('round-trips a larger batch, omitting only the malformed entries', async () => {
    const items: ClassifyItem[] = Array.from({ length: 10 }, (_, i) => ({ word: `w${i}` }));
    const response = JSON.stringify(
      items.map((it, i) => ({
        word: it.word,
        // every 4th entry is given a bogus domain that must be dropped
        domain: i % 4 === 0 ? 'not_a_domain' : 'work',
      })),
    );
    const result = await classifyWords(items, mockProvider(response));
    expect(result).toHaveLength(items.filter((_, i) => i % 4 !== 0).length);
    expect(result.every((r) => r.domain === 'work')).toBe(true);
  });
});
