// Pure Anki helpers, server side (#241). Mirrors the client copies in
// src/lib/anki.ts / src/lib/words.ts — the established convention for pure
// helpers used on both sides (see CLAUDE.md). The API owns the DB and the
// addon-facing endpoints; the client copies keep serving the selfhost
// browser→AnkiConnect path until it is retired.

import type { WordState } from '../db';

/**
 * Rank used for upgrade-only sync (ignored shares known's rank so it is never
 * overridden). Mirrors STATE_RANK in src/lib/anki.ts.
 */
const STATE_RANK: Record<WordState, number> = {
  new: 0, level1: 1, level2: 2, level3: 3, level4: 4, known: 5, ignored: 5,
};

export function stateRank(state: WordState): number {
  return STATE_RANK[state];
}

/**
 * Map a raw Anki card (type + interval) to a lector vocab state, or `null`
 * when the card carries no learning signal yet. A New card is queued in Anki
 * but has never been studied, so the sync ignores it entirely.
 *
 * New (0)            → null     — queued but not yet studied; ignored
 * Learning (1)       → level1   — in initial learning steps
 * Relearning (3)     → level2   — lapsed, being relearned
 * Young (2, < 21 d)  → level4   — graduated to review, almost known
 * Mature (2, ≥ 21 d) → known    — stable long-term recall; treat as known
 */
export function ankiCardToState(type: number, interval: number): WordState | null {
  if (type === 0) return null;
  if (type === 1) return 'level1';
  if (type === 3) return 'level2';
  return interval >= 21 ? 'known' : 'level4';
}

/**
 * Strip surrounding punctuation from a cloze word, returning [cleanWord,
 * trailingPunctuation]. Mirrors src/lib/words.ts (issues #68, #108): bank
 * words can carry trailing punctuation ("haar.") and leading quotes („Sind),
 * either of which would make the word-boundary pattern unmatchable. The
 * leading strip deliberately spares the apostrophe so the Afrikaans 'n
 * article survives.
 */
export function splitTrailingPunctuation(word: string): [string, string] {
  const noLead = word.replace(/^[„“”"«»‹›(\[{¿¡]+/u, '');
  const match = noLead.match(/^(.+?)([.,!?;:'"„“”«»‹›)\]}…]+)$/u);
  if (match) return [match[1], match[2]];
  return [noLead, ''];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Unicode-aware whole-word pattern (#289): \b is ASCII-only, so it saw a
 *  boundary inside "Häuser" at the ä; the lookarounds treat any letter/digit
 *  neighbor as word-internal, in every script. */
function wholeWordPattern(word: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(${escapeRegex(word)})(?![\\p{L}\\p{N}_])`, 'giu');
}

/**
 * Build the cloze-deletion text for a sentence, or a cloze-less string when
 * the target doesn't appear (callers must check for `{{c1::`). Mirrors
 * buildClozeText in src/lib/anki.ts.
 */
export function buildClozeText(sentence: string, targetWord: string): string {
  const [cleanTarget] = splitTrailingPunctuation(targetWord);
  return sentence.replace(wholeWordPattern(cleanTarget), '{{c1::$1}}');
}

/**
 * Bold every whole-word occurrence of the target in the sentence — the
 * pre-rendered Sentence field for basic cards (mirrors addBasicCard's
 * highlighting in src/lib/anki.ts, so addon-created and browser-created
 * cards look identical).
 */
export function highlightWordHtml(sentence: string, targetWord: string): string {
  const [cleanTarget] = splitTrailingPunctuation(targetWord);
  return sentence.replace(wholeWordPattern(cleanTarget), '<b>$1</b>');
}
