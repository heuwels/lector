// Shared word-token helpers.
// Part of the cloze sentence bank stores clozeWords with trailing punctuation
// attached (e.g. "haar."), so anything matching, displaying, or persisting a
// cloze word must strip it first (issues #68, #108).

/** Strip trailing punctuation from a word, returning [cleanWord, punctuation]. */
export function splitTrailingPunctuation(word: string): [string, string] {
  const match = word.match(/^(.+?)([.,!?;:'")\]]+)$/);
  if (match) return [match[1], match[2]];
  return [word, ''];
}
