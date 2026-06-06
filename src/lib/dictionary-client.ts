/**
 * Client-side dictionary lookup. Calls /api/dictionary/lookup, which queries
 * the SQLite Afrikaans dictionary built by scripts/build-dictionary.ts.
 *
 * Returns the rich entry shape on a hit, or null on a miss — callers should
 * fall back to the AI translate API when null.
 */

export interface ExpandedDictionaryEntry {
  word: string;
  rank?: number;
  ipa?: string;
  etymology?: string;
  senses: Array<{ partOfSpeech: string; gloss: string }>;
  relatedForms?: Array<{ form: string; relation: string }>;
  lemmaInfo?: { stem: string; label: string };
}

/**
 * In-memory session cache. Map of lowercase word → entry (or null for misses).
 * Cleared on page reload — there's no persistence so memory pressure is bounded
 * by how many distinct words the user looks up in one session (typically <500).
 */
const sessionCache = new Map<string, ExpandedDictionaryEntry | null>();

export async function lookupWordRemote(word: string): Promise<ExpandedDictionaryEntry | null> {
  const key = word.toLowerCase();
  if (sessionCache.has(key)) {
    return sessionCache.get(key) ?? null;
  }

  const url = `/api/dictionary/lookup?word=${encodeURIComponent(word)}`;
  const res = await fetch(url);
  if (!res.ok) {
    // Don't cache transport errors — let the next click retry.
    return null;
  }
  const data = await res.json();
  const entry: ExpandedDictionaryEntry | null = data.entry ?? null;
  sessionCache.set(key, entry);
  return entry;
}

/** Drop a single cached entry (call after editing the dict to force a re-fetch). */
export function invalidateLookupCache(word?: string): void {
  if (word === undefined) sessionCache.clear();
  else sessionCache.delete(word.toLowerCase());
}

/**
 * Convenience: collapse an entry's first sense into the legacy
 * `{ translation, partOfSpeech }` shape used by older code paths.
 */
export function entryToLegacyTranslation(entry: ExpandedDictionaryEntry): {
  translation: string;
  partOfSpeech: string | null;
} {
  const first = entry.senses[0];
  const allGlosses = entry.senses.map((s) => s.gloss).join('; ');
  return {
    translation: allGlosses || first?.gloss || '',
    partOfSpeech: first?.partOfSpeech || null,
  };
}
