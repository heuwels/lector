import {
  foldWord,
  normalizeText,
  splitSentences,
  tokenizeWords,
  type LanguageConfig,
} from './languages';

/**
 * The sentence in `text` that contains `word`, or null when none does. Used to
 * backfill `vocab.sentence` when a save did not carry the reader's context, so
 * SRS cloze has a sentence to blank. Single words match on a folded token (so
 * "the" does not match "other"); a phrase matches on the folded text.
 */
export function deriveContextSentence(
  text: string,
  word: string,
  pack: LanguageConfig,
): string | null {
  const needle = foldWord(normalizeText(word), pack).trim();
  if (!needle) return null;

  const phrase = /\s/.test(needle);
  for (const sentence of splitSentences(text, pack)) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (phrase) {
      if (foldWord(normalizeText(trimmed), pack).includes(needle)) return trimmed;
    } else if (
      tokenizeWords(trimmed, pack).some(
        (token) => foldWord(normalizeText(token.text), pack) === needle,
      )
    ) {
      return trimmed;
    }
  }

  return null;
}
