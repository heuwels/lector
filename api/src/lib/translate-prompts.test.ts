import { describe, expect, test } from 'bun:test';
import {
  buildGlossPrompt,
  buildPhrasePrompt,
  buildSimpleContextPrompt,
  buildSimplePhrasePrompt,
  buildWordEntryPrompt,
} from './translate-prompts';
import { getSpelreelsContext } from './spelreels';

const WORD = 'seemeeu';
const SENTENCE = 'By die see sien sy n seemeeu wat oor die water vlieg.';

// A fragment that only appears in the injected Afrikaans spelreels block.
const SPELREELS_MARKER = 'Spelreëls';

describe('buildGlossPrompt (fast path)', () => {
  const prompt = buildGlossPrompt('Afrikaans', WORD, SENTENCE);

  test('includes the word and sentence', () => {
    expect(prompt).toContain(WORD);
    expect(prompt).toContain(SENTENCE);
  });

  test('asks for plain text, not JSON', () => {
    expect(prompt).not.toContain('JSON');
    expect(prompt).not.toContain('"senses"');
  });

  test('never carries the spelreels ruleset', () => {
    expect(prompt).not.toContain(SPELREELS_MARKER);
    expect(prompt).not.toContain(getSpelreelsContext());
  });

  test('stays short (the whole point of the fast path)', () => {
    // Generous ceiling: the real prompt is ~400 chars. The old word prompt with
    // spelreels was ~13k+. This guards against the ruleset sneaking back in.
    expect(prompt.length).toBeLessThan(1000);
  });
});

describe('buildWordEntryPrompt (enrich path)', () => {
  const prompt = buildWordEntryPrompt('Afrikaans', WORD, SENTENCE);

  test('requests the rich structured schema', () => {
    expect(prompt).toContain('"senses"');
    expect(prompt).toContain('"ipa"');
    expect(prompt).toContain('"etymology"');
    expect(prompt).toContain('"relatedForms"');
  });

  test('never carries the spelreels ruleset (the regression we are fixing)', () => {
    expect(prompt).not.toContain(SPELREELS_MARKER);
    expect(prompt).not.toContain(getSpelreelsContext());
  });
});

describe('bounded Free prompts', () => {
  test('simple phrase contains the selection and context but no rich schema or spelreels', () => {
    const prompt = buildSimplePhrasePrompt('Afrikaans', 'die appel', SENTENCE);
    expect(prompt).toContain('die appel');
    expect(prompt).toContain(SENTENCE);
    expect(prompt).not.toContain(SPELREELS_MARKER);
    expect(prompt).not.toContain(getSpelreelsContext());
    expect(prompt).not.toContain('literalBreakdown');
    expect(prompt).not.toContain('idiomaticMeaning');
    expect(prompt).not.toContain('usageNotes');
    expect(prompt).not.toContain('etymology');
    expect(prompt).toContain('ONLY');
  });

  test('simple context asks for one sense without rich dictionary fields', () => {
    const prompt = buildSimpleContextPrompt('Afrikaans', WORD, SENTENCE);
    expect(prompt).toContain(WORD);
    expect(prompt).toContain(SENTENCE);
    expect(prompt).not.toContain(SPELREELS_MARKER);
    expect(prompt).not.toContain(getSpelreelsContext());
    expect(prompt).not.toContain('relatedForms');
    expect(prompt).not.toContain('etymology');
    expect(prompt).not.toContain('partOfSpeech');
    expect(prompt).toContain('ONLY');
  });
});

describe('buildPhrasePrompt (keeps spelreels for af)', () => {
  test('embeds the spelreels section when one is provided', () => {
    const section = `Use the following official spelling rules:\n\n${getSpelreelsContext()}\n\n---\n\n`;
    const prompt = buildPhrasePrompt('Afrikaans', section, 'die appel van my oog', SENTENCE);
    expect(prompt).toContain(SPELREELS_MARKER);
  });

  test('omits it when the section is empty (non-af languages)', () => {
    const prompt = buildPhrasePrompt('German', '', 'der Apfel', SENTENCE);
    expect(prompt).not.toContain(SPELREELS_MARKER);
  });
});
