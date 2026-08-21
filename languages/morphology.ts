// Stem candidates for a written form the dictionary has no key for. Shared by
// the runtime lookup (api/src/lib/dictionary-db.ts) and the build-time coverage
// gate (scripts/build-dictionary.ts), so the gate measures what the lookup
// resolves.

import type { MorphologyConfig } from './types';

/** A key to try, with what was peeled to reach it. */
export interface StemCandidate {
  /** The dictionary key to look up. */
  key: string;
  /** What came off, innermost first, for the "… form of" label. */
  peeled: string[];
}

function longestFirst(items: string[]): string[] {
  return [...items].sort((a, b) => b.length - a.length);
}

/**
 * Every key worth trying for `word`, best first.
 *
 * Two operations, in order. A clitic peel leaves a key as written, because a
 * postposition attaches to a finished word: 도서관에서 gives 도서관. An ending peel
 * appends `citation`, because a verb stem is not a word on its own: 좋아하지 gives
 * the stem 좋아하, and the dictionary form is 좋아하다.
 *
 * Clitics run first, and a shallow peel runs before a deep one, so the answer
 * needs the least work to explain. Within one depth the longest match wins, so
 * 에게서 beats 에.
 *
 * This function only proposes. The caller decides which key resolves, because
 * whether 나 is the pronoun or 나 with a peeled 는 is a question about the
 * dictionary and not about the string.
 */
export function stemCandidates(word: string, config: MorphologyConfig): StemCandidate[] {
  const out: StemCandidate[] = [];
  const seen = new Set<string>([word]);

  const clitics = longestFirst(config.clitics);
  let frontier: StemCandidate[] = [{ key: word, peeled: [] }];
  for (let depth = 0; depth < config.maxClitics; depth++) {
    const next: StemCandidate[] = [];
    for (const current of frontier) {
      for (const clitic of clitics) {
        if (!current.key.endsWith(clitic)) continue;
        const key = current.key.slice(0, -clitic.length);
        if (key.length < config.minStem) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        const candidate = { key, peeled: [...current.peeled, clitic] };
        out.push(candidate);
        next.push(candidate);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  if (config.endings && config.citation) {
    for (const ending of longestFirst(config.endings)) {
      if (!word.endsWith(ending)) continue;
      const stem = word.slice(0, -ending.length);
      if (stem.length < config.minStem) continue;
      const key = stem + config.citation;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, peeled: [ending] });
    }
  }

  if (config.prefixes) {
    const prefixBases: StemCandidate[] = [{ key: word, peeled: [] }, ...out];
    for (const base of prefixBases) {
      for (const prefix of longestFirst(config.prefixes)) {
        if (!base.key.startsWith(prefix)) continue;
        const key = base.key.slice(prefix.length);
        if (key.length < config.minStem) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, peeled: [...base.peeled, prefix] });
      }
    }
  }

  return out;
}
