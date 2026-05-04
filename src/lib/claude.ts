import { getActiveLanguage } from './data-layer';

// Types
export interface WordTranslation {
  translation: string;
  partOfSpeech?: string;
}

export interface PhraseTranslation {
  translation: string;
  literalBreakdown?: string;
  idiomaticMeaning?: string;
}

/**
 * Translate a single word with surrounding sentence context
 * @param word - The word to translate
 * @param sentence - The full sentence containing the word (for context)
 * @returns Translation with optional part of speech
 */
export async function translateWord(
  word: string,
  sentence: string
): Promise<WordTranslation> {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, sentence, type: 'word', language: getActiveLanguage() }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Translation failed');
  }

  return response.json();
}

/**
 * Translate a phrase with surrounding sentence context
 * @param phrase - The phrase to translate
 * @param sentence - The full sentence containing the phrase (for context)
 * @returns Translation with optional literal breakdown and idiomatic meaning
 */
export async function translatePhrase(
  phrase: string,
  sentence: string
): Promise<PhraseTranslation> {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word: phrase, sentence, type: 'phrase', language: getActiveLanguage() }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Translation failed');
  }

  return response.json();
}
