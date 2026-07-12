// Shared word-token helpers.
// Part of the cloze sentence bank stores clozeWords with trailing punctuation
// attached (e.g. "haar."), so anything matching, displaying, or persisting a
// cloze word must strip it first (issues #68, #108).

import { foldWord, tokenizeWords, type LanguageConfig } from './languages';

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

/**
 * True when `word` appears as a whole token in `sentence` (folded-key
 * comparison: case-insensitive, NFC). Substring hits don't count: "gesien"
 * does not contain the word "sien". Used to decide whether a sentence is
 * genuine context for a word — e.g. a nested dictionary lookup (issue #106)
 * carries the sentence of the word the user actually clicked, which may only
 * contain an inflected form.
 *
 * Tokenization is the pack's (#289): elisions arrive pre-split (l'eau →
 * l + eau), so the content word matches directly. A multi-token target
 * (legacy vocab like "l'eau", or a short phrase) matches when its word tokens
 * appear as a consecutive run.
 */
export function sentenceContainsWord(
  sentence: string,
  word: string,
  pack: LanguageConfig,
): boolean {
  const targetTokens = tokenizeWords(word, pack).map((t) => foldWord(t.text, pack));
  if (targetTokens.length === 0) return false;

  const sentenceTokens = tokenizeWords(sentence, pack).map((t) => foldWord(t.text, pack));
  if (targetTokens.length === 1) return sentenceTokens.includes(targetTokens[0]);

  outer: for (let i = 0; i <= sentenceTokens.length - targetTokens.length; i++) {
    for (let j = 0; j < targetTokens.length; j++) {
      if (sentenceTokens[i + j] !== targetTokens[j]) continue outer;
    }
    return true;
  }
  return false;
}
