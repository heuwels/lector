// Shared word-token helpers.
// Part of the cloze sentence bank stores clozeWords with trailing punctuation
// attached (e.g. "haar."), so anything matching, displaying, or persisting a
// cloze word must strip it first (issues #68, #108).

import { foldWord, tokenizeWords, vocabKeys, type LanguageConfig } from './languages';

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
  // The ano teleia · is Greek's strong colon (#254); the Greek question mark
  // is the ASCII-lookalike ; already in the class.
  //
  // Arabic writes its own comma ،, semicolon ؛ and question mark ؟ (#253).
  // Without them a sentence-final cloze answer keeps its punctuation: the bank
  // stores كتاب؟ as the answer, so the blank printed كتاب؟ and a learner who
  // typed the word was marked wrong. 195 of the 7,126 Arabic bank rows end in
  // one of these. They cannot collide with another script — no Latin, Cyrillic
  // or Greek text writes them.
  const match = noLead.match(/^(.+?)([.,!?;:·،؛؟'"„“”«»‹›)\]}…]+)$/u);
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
 * Tokenization is the pack's (#289): French elisions arrive pre-split
 * (l'eau → l + eau), so the content word matches directly. Italian keeps
 * the elision as one token (l'acqua). A single-token target also matches
 * when either side peels to the same stem, so `acqua` hits `dell'acqua`.
 * A multi-token target (legacy vocab like "l'eau", or a short phrase)
 * matches when its word tokens appear as a consecutive run.
 */
export function sentenceContainsWord(
  sentence: string,
  word: string,
  pack: LanguageConfig,
): boolean {
  const targetTokens = tokenizeWords(word, pack).map((t) => foldWord(t.text, pack));
  if (targetTokens.length === 0) return false;

  const sentenceTokens = tokenizeWords(sentence, pack).map((t) => foldWord(t.text, pack));
  if (targetTokens.length === 1) {
    const targetKeys = new Set(vocabKeys(targetTokens[0], pack));
    return sentenceTokens.some((token) =>
      vocabKeys(token, pack).some((key) => targetKeys.has(key)),
    );
  }

  outer: for (let i = 0; i <= sentenceTokens.length - targetTokens.length; i++) {
    for (let j = 0; j < targetTokens.length; j++) {
      if (sentenceTokens[i + j] !== targetTokens[j]) continue outer;
    }
    return true;
  }
  return false;
}
