import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { AnthropicProvider } from './anthropic';

const ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_WORD_MODEL',
  'ANTHROPIC_PHRASE_MODEL',
  'ANTHROPIC_CHAT_MODEL',
] as const;

describe('AnthropicProvider model selection', () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot then clear so each test starts from a known, env-free baseline.
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('defaults every task to claude-sonnet-4-6 when nothing is configured', () => {
    const p = new AnthropicProvider({ apiKey: 'test' });
    expect(p.modelForTask()).toBe('claude-sonnet-4-6');
    expect(p.modelForTask('word-translation')).toBe('claude-sonnet-4-6');
    expect(p.modelForTask('phrase-translation')).toBe('claude-sonnet-4-6');
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
    expect(p.modelForTask('word-translation')).toBe('claude-haiku-4-5');
    expect(p.modelForTask('phrase-translation')).toBe('claude-opus-4-8');
    expect(p.modelForTask('chat')).toBe('claude-opus-4-8');
    expect(p.modelForTask()).toBe('claude-sonnet-4-6');
  });

  test('per-task env vars override the general default; unset tasks fall back', () => {
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
    process.env.ANTHROPIC_WORD_MODEL = 'claude-haiku-4-5';
    const p = new AnthropicProvider({ apiKey: 'test' });
    expect(p.modelForTask('word-translation')).toBe('claude-haiku-4-5');
    expect(p.modelForTask('phrase-translation')).toBe('claude-sonnet-4-6');
    expect(p.modelForTask('chat')).toBe('claude-sonnet-4-6');
  });

  test('explicit options beat env vars', () => {
    process.env.ANTHROPIC_WORD_MODEL = 'from-env';
    const p = new AnthropicProvider({ apiKey: 'test', wordModel: 'from-option' });
    expect(p.modelForTask('word-translation')).toBe('from-option');
  });

  test('an unknown task falls back to the general default', () => {
    const p = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-4-6' });
    // @ts-expect-error — deliberately exercising the default branch
    expect(p.modelForTask('something-else')).toBe('claude-sonnet-4-6');
  });
});
