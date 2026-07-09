/**
 * Client-side dictionary lookup. Calls /api/dictionary/lookup, which queries
 * the SQLite dictionary for the active language (built by
 * scripts/build-dictionary.ts).
 *
 * Returns the rich entry shape on a hit, or null on a miss — callers should
 * fall back to the AI translate API when null.
 */
import { getActiveLanguage, getActivePack } from './data-layer';
import { foldWord } from './languages';
import { apiFetch } from './api-base';

export interface ExpandedDictionaryEntry {
  word: string;
  rank?: number;
  ipa?: string;
  etymology?: string;
  senses: Array<{ partOfSpeech: string; gloss: string }>;
  relatedForms?: Array<{ form: string; relation: string }>;
  lemmaInfo?: { stem: string; label: string };
  /** `dict` = built-in kaikki dict, `cache` = user-learned AI translation. */
  source?: 'dict' | 'cache';
}

/**
 * In-memory session cache. Map of `${language}:${lowercase word}` → entry (or
 * null for misses) — keyed by language so the same word in different target
 * languages doesn't collide. Cleared on page reload, so memory is bounded by
 * how many distinct words the user looks up in one session (typically <500).
 */
const sessionCache = new Map<string, ExpandedDictionaryEntry | null>();

export async function lookupWordRemote(word: string): Promise<ExpandedDictionaryEntry | null> {
  const language = getActiveLanguage();
  const key = `${language}:${foldWord(word, getActivePack())}`;
  if (sessionCache.has(key)) {
    return sessionCache.get(key) ?? null;
  }

  const url = `/api/dictionary/lookup?word=${encodeURIComponent(word)}&language=${language}`;
  const res = await apiFetch(url);
  if (!res.ok) {
    // Don't cache transport errors — let the next click retry.
    return null;
  }
  const data = await res.json();
  const entry: ExpandedDictionaryEntry | null = data.entry ?? null;
  sessionCache.set(key, entry);
  return entry;
}

/** Drop a single cached entry (call after editing the dict to force a re-fetch).
 *  Keys are `${language}:${word}`, so invalidate the word across every language. */
export function invalidateLookupCache(word?: string): void {
  if (word === undefined) {
    sessionCache.clear();
    return;
  }
  const suffix = `:${foldWord(word, getActivePack())}`;
  for (const key of sessionCache.keys()) {
    if (key.endsWith(suffix)) sessionCache.delete(key);
  }
}

export interface CacheAcceptedTranslationInput {
  word: string;
  senses: Array<{ partOfSpeech: string; gloss: string }>;
  ipa?: string;
  etymology?: string;
  relatedForms?: Array<{ form: string; relation: string }>;
  sourceSentence?: string;
  language?: string;
}

/**
 * Persist an accepted AI translation into the on-device cache (lector.db).
 * Called from the read page when the user saves to vocab / marks known /
 * sets a learning level — actions that signal trust in the translation.
 *
 * Fire-and-forget: we don't block the UI on the write. Errors are logged.
 * The session lookup cache is invalidated for the word so the next click
 * re-fetches and picks up the freshly-cached entry (now with `source: 'cache'`).
 */
export async function cacheAcceptedTranslation(input: CacheAcceptedTranslationInput): Promise<void> {
  if (!input.word || !input.senses?.length) return;
  invalidateLookupCache(input.word);
  try {
    const res = await apiFetch('/api/dictionary/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('cacheAcceptedTranslation failed:', err);
    }
  } catch (err) {
    console.warn('cacheAcceptedTranslation network error:', err);
  }
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
