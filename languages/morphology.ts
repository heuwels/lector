// Stem candidates for a written form the dictionary has no key for. Shared by
// the runtime lookup (api/src/lib/dictionary-db.ts) and the build-time coverage
// gate (scripts/build-dictionary.ts), so the gate measures what the lookup
// resolves.

import { foldWord } from './text';
import type { LanguageConfig, MorphologyConfig } from './types';

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
 * A prefix peel also runs shallow-first, and it may stack up to `maxPrefixes`
 * deep. Arabic needs the depth: وبالقلم carries three proclitics before the
 * noun, and a one-pass peel stops at بالقلم, which is not a key.
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
    const prefixes = longestFirst(config.prefixes);
    // Stacking is opt-in, and one pass is what id and it want. Arabic sets 3:
    // وبالقلم needs و, then ب, then ال before it reaches a key.
    const maxPrefixes = config.maxPrefixes ?? 1;
    let prefixFrontier: StemCandidate[] = [{ key: word, peeled: [] }, ...out];
    for (let depth = 0; depth < maxPrefixes; depth++) {
      const next: StemCandidate[] = [];
      for (const base of prefixFrontier) {
        for (const prefix of prefixes) {
          if (!base.key.startsWith(prefix)) continue;
          const key = base.key.slice(prefix.length);
          if (key.length < config.minStem) continue;
          if (seen.has(key)) continue;
          seen.add(key);
          const candidate = { key, peeled: [...base.peeled, prefix] };
          out.push(candidate);
          next.push(candidate);
        }
      }
      if (next.length === 0) break;
      prefixFrontier = next;
    }
  }

  if (config.mutations) {
    const mutations = [...config.mutations].sort((a, b) => b.from.length - a.from.length);
    const mutationBases: StemCandidate[] = [{ key: word, peeled: [] }, ...out];
    for (const base of mutationBases) {
      for (const mutation of mutations) {
        if (!base.key.startsWith(mutation.from)) continue;
        const key = mutation.to + base.key.slice(mutation.from.length);
        if (key.length < config.minStem) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, peeled: [...base.peeled, mutation.from] });
      }
    }
  }

  return out;
}

/**
 * Folded key plus stems reached by peeling an apostrophe prefix. Used
 * anywhere a written token has to find a stored key (known-word colour,
 * sentence context). `l'acqua` and `acqua` share a key. An Indonesian
 * prefix peel (membeli → beli) does not: that is a different word, not
 * another spelling of the same token. The surface form comes first.
 *
 * KNOWN LIMITATION for Arabic (#253). Only an apostrophe peel counts here, so
 * الكتاب and كتاب do not share a key: a learner who marks كتاب known still sees
 * الكتاب painted as new. That is the Indonesian rule applied consistently, and
 * for Indonesian it is right — a voice prefix makes a different word. Arabic is
 * the case where it reads wrong, because the definite article is not a
 * derivation and most nouns in running text carry it.
 *
 * Left alone on purpose rather than widened here. Adding the proclitic peel to
 * this function would colour a token by a key the learner never marked, for
 * every pack that declares `prefixes`, and the lookup already answers الكتاب
 * correctly through the peel in dictionary-db.ts. The reader's COLOUR is the
 * only surface that disagrees. Worth its own change, with its own measurement.
 */
export function vocabKeys(word: string, pack: LanguageConfig): string[] {
  const folded = foldWord(word, pack);
  if (!pack.morphology) return [folded];
  const keys = [folded];
  const seen = new Set(keys);
  for (const candidate of stemCandidates(folded, pack.morphology)) {
    if (!candidate.peeled.some((part) => part.includes("'"))) continue;
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    keys.push(candidate.key);
  }
  return keys;
}

/** First state stored under any of the word's vocab keys. */
export function lookupByVocabKeys<T>(
  map: Map<string, T>,
  word: string,
  pack: LanguageConfig,
): T | undefined {
  for (const key of vocabKeys(word, pack)) {
    const hit = map.get(key);
    if (hit !== undefined) return hit;
  }
}
