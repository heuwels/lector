import { getActiveLanguage } from './data-layer';

// Types
export interface WordTranslation {
  /** Legacy: stitched single-string translation (sense glosses joined "; "). */
  translation: string;
  /** Legacy: first sense's POS. */
  partOfSpeech?: string;
  /** Structured fields used by the drawer + the on-device cache. */
  word?: string;
  senses?: Array<{ partOfSpeech: string; gloss: string }>;
  ipa?: string;
  etymology?: string;
  relatedForms?: Array<{ form: string; relation: string }>;
}

export interface PhraseTranslation {
  translation: string;
  literalBreakdown?: string;
  idiomaticMeaning?: string;
  usageNotes?: string;
  register?: 'formal' | 'informal' | 'literary' | 'colloquial' | 'archaic' | 'neutral';
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
 * Fast-path word gloss — streams a plain-text translation so the reader sees
 * the meaning form as it generates instead of waiting for a full structured
 * entry. Calls `onDelta` with the cumulative text on every chunk and resolves
 * with the final trimmed gloss. Throws if the stream yields nothing (so the
 * caller can show an error / fall back).
 *
 * Pair with `enrichWord` for the opt-in rich entry (senses / IPA / etymology).
 */
export async function streamWordGloss(
  word: string,
  sentence: string,
  onDelta: (cumulative: string) => void,
): Promise<string> {
  const response = await fetch('/api/translate/gloss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, sentence, language: getActiveLanguage() }),
  });

  if (!response.ok || !response.body) {
    let message = 'Translation failed';
    try {
      const error = await response.json();
      message = error.error || message;
    } catch {
      /* non-JSON error body — keep the default */
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onDelta(text);
  }
  text += decoder.decode();
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Translation failed');
  onDelta(trimmed);
  return trimmed;
}

/**
 * Opt-in rich dictionary entry for a word (senses, IPA, etymology, related
 * forms) — the "enrich" action behind the streamed gloss. Same shape as
 * translateWord; hits the dedicated /enrich endpoint.
 */
export async function enrichWord(
  word: string,
  sentence: string,
): Promise<WordTranslation> {
  const response = await fetch('/api/translate/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, sentence, language: getActiveLanguage() }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Enrich failed');
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
