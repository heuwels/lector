import { describe, test, expect } from 'bun:test';
import { deriveContextSentence } from './context-sentence';
import { getLanguageConfig } from './languages';

const en = getLanguageConfig('en');
const TEXT = 'The quick brown fox jumps. A lazy dog sleeps. The other dog barks.';

describe('deriveContextSentence', () => {
  test('returns the sentence containing the word', () => {
    expect(deriveContextSentence(TEXT, 'fox', en)).toBe('The quick brown fox jumps.');
    expect(deriveContextSentence(TEXT, 'sleeps', en)).toBe('A lazy dog sleeps.');
  });

  test('matches whole tokens, not substrings', () => {
    expect(deriveContextSentence('Another cat.', 'an', en)).toBeNull();
    expect(deriveContextSentence('Another cat.', 'cat', en)).toBe('Another cat.');
  });

  test('matches a multi-word phrase on the folded text', () => {
    expect(
      deriveContextSentence('He was struck by lightning yesterday.', 'struck by lightning', en),
    ).toBe('He was struck by lightning yesterday.');
  });

  test('returns null when the word is absent', () => {
    expect(deriveContextSentence(TEXT, 'zebra', en)).toBeNull();
    expect(deriveContextSentence('', 'fox', en)).toBeNull();
  });
});
