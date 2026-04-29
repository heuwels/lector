import rootData from './dictionary-roots.json';

export interface DictionaryEntry {
  word: string;
  rank: number;
  translation: string;
  partOfSpeech: string;
  /** Present when the word was found via affix stripping */
  lemmaInfo?: { stem: string; label: string };
}

interface DerivedEntry {
  rank: number;
  translation: string;
  partOfSpeech?: string;
}

interface RootEntry {
  rank: number;
  translation: string;
  partOfSpeech: string;
  prefixes?: Record<string, DerivedEntry>;
  suffixes?: Record<string, DerivedEntry>;
}

const roots = rootData as Record<string, RootEntry>;

// Ordered longest-first to avoid premature matches
const PREFIXES = ['ont', 'ver', 'her', 'ge', 'be'];
const SUFFIXES = ['heid', 'tjie', 'jie', 'ing', 'lik', 'te', 'de', 'e', 's'];
const PREFIX_LABELS: Record<string, string> = {
  ge: 'past participle of', ver: 'derived from', be: 'derived from',
  her: 'repetition of', ont: 'derived from',
};
const SUFFIX_LABELS: Record<string, string> = {
  heid: 'abstract noun from', tjie: 'diminutive of', jie: 'diminutive of',
  ing: 'nominalization of', lik: 'adverbial form of', te: 'inflected form of',
  de: 'inflected form of', e: 'inflected/plural of', s: 'plural of',
};

const VOWELS = new Set('aeiouyêëéèôöûüîïáà'.split(''));
const MIN_STEM = 2;

function undoubleConsonant(stem: string): string | null {
  if (stem.length >= 3) {
    const last = stem[stem.length - 1];
    if (last === stem[stem.length - 2] && !VOWELS.has(last)) {
      return stem.slice(0, -1);
    }
  }
  return null;
}

function rootToEntry(word: string, root: RootEntry): DictionaryEntry {
  return { word, rank: root.rank, translation: root.translation, partOfSpeech: root.partOfSpeech };
}

function derivedToEntry(word: string, root: RootEntry, derived: DerivedEntry, stem: string, label: string): DictionaryEntry {
  return {
    word,
    rank: derived.rank,
    translation: derived.translation,
    partOfSpeech: derived.partOfSpeech || root.partOfSpeech,
    lemmaInfo: { stem, label },
  };
}

/**
 * Look up a word in the dictionary.
 * Checks: exact root → prefix derivation → suffix derivation → affix-strip fallback.
 */
export function lookupWord(word: string): DictionaryEntry | undefined {
  const lower = word.toLowerCase();

  // 1. Exact root match
  const root = roots[lower];
  if (root) return rootToEntry(lower, root);

  // 2. Check if it's a known prefix derivation
  for (const prefix of PREFIXES) {
    if (!lower.startsWith(prefix)) continue;
    const stem = lower.slice(prefix.length);
    if (stem.length < MIN_STEM) continue;

    const stemRoot = roots[stem];
    if (stemRoot?.prefixes?.[prefix]) {
      return derivedToEntry(lower, stemRoot, stemRoot.prefixes[prefix], stem, PREFIX_LABELS[prefix]);
    }
  }

  // 3. Check if it's a known suffix derivation
  for (const suffix of SUFFIXES) {
    if (!lower.endsWith(suffix)) continue;
    const stem = lower.slice(0, -suffix.length);
    if (stem.length < MIN_STEM) continue;

    const stemRoot = roots[stem];
    if (stemRoot?.suffixes?.[suffix]) {
      return derivedToEntry(lower, stemRoot, stemRoot.suffixes[suffix], stem, SUFFIX_LABELS[suffix]);
    }

    // Try consonant undoubling
    const undoubled = undoubleConsonant(stem);
    if (undoubled && undoubled.length >= MIN_STEM) {
      const undoubledRoot = roots[undoubled];
      if (undoubledRoot?.suffixes?.[suffix]) {
        return derivedToEntry(lower, undoubledRoot, undoubledRoot.suffixes[suffix], undoubled, SUFFIX_LABELS[suffix]);
      }
    }
  }

  // 4. Affix-strip fallback: strip affix and use root entry with generic label
  for (const prefix of PREFIXES) {
    if (!lower.startsWith(prefix)) continue;
    const stem = lower.slice(prefix.length);
    if (stem.length >= MIN_STEM && roots[stem]) {
      const r = roots[stem];
      return { ...rootToEntry(lower, r), rank: 0, lemmaInfo: { stem, label: PREFIX_LABELS[prefix] } };
    }
  }

  for (const suffix of SUFFIXES) {
    if (!lower.endsWith(suffix)) continue;
    const stem = lower.slice(0, -suffix.length);

    if (stem.length >= MIN_STEM && roots[stem]) {
      const r = roots[stem];
      return { ...rootToEntry(lower, r), rank: 0, lemmaInfo: { stem, label: SUFFIX_LABELS[suffix] } };
    }

    const undoubled = undoubleConsonant(stem);
    if (undoubled && undoubled.length >= MIN_STEM && roots[undoubled]) {
      const r = roots[undoubled];
      return { ...rootToEntry(lower, r), rank: 0, lemmaInfo: { stem: undoubled, label: SUFFIX_LABELS[suffix] } };
    }
  }

  return undefined;
}

/**
 * Check if a word exists in the dictionary (exact root match only)
 */
export function hasWord(word: string): boolean {
  return word.toLowerCase() in roots;
}

/**
 * Get word frequency rank (lower = more common)
 */
export function getWordRank(word: string): number | undefined {
  return lookupWord(word)?.rank || undefined;
}
