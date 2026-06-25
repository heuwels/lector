// Shared word-token helpers.
// Part of the cloze sentence bank stores clozeWords with trailing punctuation
// attached (e.g. "haar."), so anything matching, displaying, or persisting a
// cloze word must strip it first (issues #68, #108).

/**
 * Strip surrounding punctuation from a cloze word, returning [cleanWord,
 * trailingPunctuation]. Bank words carry punctuation under the app's /\s+/ split:
 * trailing (e.g. "haar.") and — for languages like German — leading (e.g. „Sind,
 * the opening quote glued to the word). Both are dropped from the clean word; the
 * leading strip covers opening quotes/brackets (incl. German „ and guillemets)
 * but NOT the apostrophe, so the Afrikaans 'n article survives. (issues #68, #108)
 */
export function splitTrailingPunctuation(word: string): [string, string] {
  const noLead = word.replace(/^[„“”"«»‹›(\[{¿¡]+/u, '');
  const match = noLead.match(/^(.+?)([.,!?;:'"„“”«»‹›)\]}…]+)$/u);
  if (match) return [match[1], match[2]];
  return [noLead, ''];
}

// Letters (incl. Latin diacritics used by Afrikaans), hyphens and apostrophes —
// anything else separates tokens. Mirrors the word shape in definition-links.ts.
const NON_TOKEN_CHARS = /[^A-Za-zÀ-ÖØ-öø-ž'’-]+/;

/**
 * True when `word` appears as a whole token in `sentence` (case-insensitive).
 * Substring hits don't count: "gesien" does not contain the word "sien".
 * Used to decide whether a sentence is genuine context for a word — e.g. a
 * nested dictionary lookup (issue #106) carries the sentence of the word the
 * user actually clicked, which may only contain an inflected form.
 */
export function sentenceContainsWord(sentence: string, word: string): boolean {
  const target = word.toLowerCase();
  if (!target) return false;
  return sentence
    .toLowerCase()
    .split(NON_TOKEN_CHARS)
    .some((token) => token === target || token.replace(/^['’]+|['’]+$/g, '') === target);
}
