import { describe, expect, test } from 'bun:test';
import { completeJson } from './complete-json';
import { LLMTruncatedError } from './errors';
import type { CompletionOptions, LLMProvider } from './types';

function mockProvider(
  outcomes: Array<string | Error>,
): LLMProvider & { calls: CompletionOptions[] } {
  const calls: CompletionOptions[] = [];
  return {
    name: 'mock',
    model: 'mock-model',
    calls,
    async complete(options) {
      calls.push(options);
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      return outcome ?? '';
    },
    stream(): AsyncIterable<string> {
      throw new Error('not used');
    },
    async healthCheck() {
      return { ok: true };
    },
  };
}

const OPTIONS = {
  messages: [{ role: 'user' as const, content: 'Return JSON' }],
  maxTokens: 100,
};

describe('completeJson', () => {
  test('returns a valid object without retrying', async () => {
    const provider = mockProvider(['{"ok":true}']);
    await expect(completeJson<{ ok: boolean }>(provider, OPTIONS)).resolves.toEqual({ ok: true });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].responseFormat).toBe('json-object');
  });

  test('retries malformed complete JSON once at the original budget', async () => {
    const provider = mockProvider(['{"ok":', '{"ok":true}']);
    await expect(completeJson<{ ok: boolean }>(provider, OPTIONS)).resolves.toEqual({ ok: true });
    expect(provider.calls.map((call) => call.maxTokens)).toEqual([100, 100]);
    expect(provider.calls[1].messages[0].content).toContain(
      'previous response could not be parsed',
    );
  });

  test('retries confirmed truncation once with double the budget', async () => {
    const provider = mockProvider([new LLMTruncatedError(100), '{"ok":true}']);
    await expect(completeJson<{ ok: boolean }>(provider, OPTIONS)).resolves.toEqual({ ok: true });
    expect(provider.calls.map((call) => call.maxTokens)).toEqual([100, 200]);
    expect(provider.calls[1].messages).toEqual(OPTIONS.messages);
  });

  test('does not retry JSON that conservative repair can recover', async () => {
    const provider = mockProvider(['{"ok":true,}']);
    await expect(completeJson<{ ok: boolean }>(provider, OPTIONS)).resolves.toEqual({ ok: true });
    expect(provider.calls).toHaveLength(1);
  });

  test('retries a repairable but incomplete outer container', async () => {
    const provider = mockProvider([
      '{"translation":"partial","details":[]',
      '{"translation":"complete","details":[]}',
    ]);
    await expect(
      completeJson<{ translation: string; details: unknown[] }>(provider, OPTIONS),
    ).resolves.toEqual({ translation: 'complete', details: [] });
    expect(provider.calls).toHaveLength(2);
  });

  test('validates the requested JSON root shape', async () => {
    const provider = mockProvider(['{"not":"an array"}', '[]']);
    await expect(
      completeJson<unknown[]>(provider, { ...OPTIONS, responseFormat: 'json-array' }),
    ).resolves.toEqual([]);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].responseFormat).toBe('json-array');
  });

  test('throws the second parse error after exactly two malformed responses', async () => {
    const provider = mockProvider(['not json', 'still not json']);
    await expect(completeJson(provider, OPTIONS)).rejects.toThrow(
      'Model did not return valid JSON',
    );
    expect(provider.calls).toHaveLength(2);
  });

  test('throws a specific error after two truncated responses', async () => {
    const provider = mockProvider([new LLMTruncatedError(100), new LLMTruncatedError(200)]);
    await expect(completeJson(provider, OPTIONS)).rejects.toThrow(
      'LLM response was truncated after retrying with a 200-token limit',
    );
    expect(provider.calls).toHaveLength(2);
  });

  test('does not retry provider errors', async () => {
    const provider = mockProvider([new Error('provider unavailable'), '{"ok":true}']);
    await expect(completeJson(provider, OPTIONS)).rejects.toThrow('provider unavailable');
    expect(provider.calls).toHaveLength(1);
  });
});
