import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { db as userDb } from './database';
import { getActiveLanguageCode } from './active-language';

/**
 * Read-only SQLite-backed bilingual dictionary, selected by the active language.
 *
 * Built by `scripts/build-dictionary.ts` from the kaikki.org Wiktionary dump
 * (merged with the hand-curated ranks in `src/lib/dictionary-roots.json`).
 * This module mirrors the lookup algorithm in `src/lib/dictionary.ts` —
 * exact → inflections → prefix derivation → suffix derivation → affix-strip
 * fallback — but exposes the richer multi-sense schema available from kaikki.
 * The affix-strip heuristics are Afrikaans-specific and only run for `af`.
 */

// The dictionary is read-only application data shipped with the image.
// Prefer DICT_DIR so it stays put when the user mounts a volume on DATA_DIR
// for their (mutable) collections/vocab data. Fall back to DATA_DIR for local
// dev (where the build script writes here) and finally to ./data.
function getDbPath(language: string): string {
  const dir = process.env.DICT_DIR || process.env.DATA_DIR || './data';
  return path.join(dir, `dictionary-${language}.db`);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExpandedDictionaryEntry {
  word: string;
  rank?: number;
  ipa?: string;
  etymology?: string;
  senses: Array<{ partOfSpeech: string; gloss: string }>;
  relatedForms?: Array<{ form: string; relation: string }>;
  lemmaInfo?: { stem: string; label: string };
  /** Where the entry came from. `dict` = built-in kaikki dict; `cache` = user-
      learned AI translation persisted via cacheAcceptedEntry. The drawer uses
      this to render the right source pill. */
  source?: 'dict' | 'cache';
}

// ---------------------------------------------------------------------------
// Lazy connection (mirrors src/lib/server/database.ts pattern)
// ---------------------------------------------------------------------------

// Connections are cached per language so switching the active language opens
// the right dictionary (the Next.js server process is long-lived). A cached
// `null` records "no dict file for this language" so we don't re-stat on every
// lookup.
const _dbs = new Map<string, DatabaseType | null>();

function getDb(language: string): DatabaseType | null {
  const cached = _dbs.get(language);
  if (cached !== undefined) return cached;

  const dbPath = getDbPath(language);
  if (!fs.existsSync(dbPath)) {
    // The dictionary DB is optional at runtime — callers fall back to the
    // legacy JSON dict + the AI translate API when this file isn't present.
    _dbs.set(language, null);
    return null;
  }
  const conn = new Database(dbPath, { readonly: true, fileMustExist: true });
  conn.pragma('journal_mode = WAL');
  _dbs.set(language, conn);
  return conn;
}

// Exposed as a proxy so consumers can `import { dictDb }` and the active
// language's DB opens lazily on first access — same shape as `db` in
// src/lib/server/database.ts.
export const dictDb = new Proxy({} as DatabaseType, {
  get(_target, prop) {
    const language = getActiveLanguageCode();
    const real = getDb(language);
    if (!real) {
      throw new Error(
        `Dictionary database not found at ${getDbPath(language)}. ` +
          `Run \`npx tsx scripts/build-dictionary.ts\` to build it.`,
      );
    }
    const value = real[prop as keyof DatabaseType];
    if (typeof value === 'function') return value.bind(real);
    return value;
  },
});

// ---------------------------------------------------------------------------
// Affix-stripping (mirrors src/lib/dictionary.ts exactly)
// ---------------------------------------------------------------------------

const PREFIXES = ['ont', 'ver', 'her', 'ge', 'be'];
const SUFFIXES = ['heid', 'tjie', 'jie', 'ing', 'lik', 'te', 'de', 'e', 's'];
const PREFIX_LABELS: Record<string, string> = {
  ge: 'past participle of',
  ver: 'derived from',
  be: 'derived from',
  her: 'repetition of',
  ont: 'derived from',
};
const SUFFIX_LABELS: Record<string, string> = {
  heid: 'abstract noun from',
  tjie: 'diminutive of',
  jie: 'diminutive of',
  ing: 'nominalization of',
  lik: 'adverbial form of',
  te: 'inflected form of',
  de: 'inflected form of',
  e: 'inflected/plural of',
  s: 'plural of',
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

// ---------------------------------------------------------------------------
// Prepared-statement helpers (cached per connection)
// ---------------------------------------------------------------------------

type Stmts = {
  selectEntry: ReturnType<DatabaseType['prepare']>;
  selectSenses: ReturnType<DatabaseType['prepare']>;
  selectRelated: ReturnType<DatabaseType['prepare']>;
  selectInflectionLemma: ReturnType<DatabaseType['prepare']>;
};

const _stmtsByLang = new Map<string, Stmts>();

function getStmts(language: string): Stmts | null {
  const cached = _stmtsByLang.get(language);
  if (cached) return cached;
  const db = getDb(language);
  if (!db) return null;
  const stmts: Stmts = {
    selectEntry: db.prepare('SELECT word, rank, ipa, etymology FROM entries WHERE word = ?'),
    selectSenses: db.prepare('SELECT pos, gloss FROM senses WHERE word = ? ORDER BY sort_order'),
    selectRelated: db.prepare('SELECT related_word, relation FROM related_forms WHERE word = ?'),
    selectInflectionLemma: db.prepare('SELECT lemma, type FROM inflections WHERE inflected_form = ? LIMIT 1'),
  };
  _stmtsByLang.set(language, stmts);
  return stmts;
}

interface EntryRow {
  word: string;
  rank: number | null;
  ipa: string | null;
  etymology: string | null;
}

interface SenseRow {
  pos: string | null;
  gloss: string;
}

interface RelatedRow {
  related_word: string;
  relation: string;
}

function buildEntry(
  row: EntryRow,
  stmts: Stmts,
  lookupWord: string,
  lemmaInfo?: { stem: string; label: string },
): ExpandedDictionaryEntry {
  const senses = (stmts.selectSenses.all(row.word) as SenseRow[]).map((s) => ({
    partOfSpeech: s.pos || '',
    gloss: s.gloss,
  }));
  const related = (stmts.selectRelated.all(row.word) as RelatedRow[]).map((r) => ({
    form: r.related_word,
    relation: r.relation,
  }));

  const entry: ExpandedDictionaryEntry = {
    word: lookupWord,
    senses,
    source: 'dict',
  };
  if (row.rank != null) entry.rank = row.rank;
  if (row.ipa) entry.ipa = row.ipa;
  if (row.etymology) entry.etymology = row.etymology;
  if (related.length) entry.relatedForms = related;
  if (lemmaInfo) entry.lemmaInfo = lemmaInfo;
  return entry;
}

// ---------------------------------------------------------------------------
// AI cache (lector.db) — entries the user "accepted" by saving / marking
// known / setting a level. Read AFTER the curated dict misses on every
// lookup path so coverage of the user's reading corpus grows over time.
// ---------------------------------------------------------------------------

interface CachedEntryRow {
  word: string;
  ipa: string | null;
  etymology: string | null;
}

function lookupCached(word: string, language: string): ExpandedDictionaryEntry | undefined {
  // Filter by language so a cached entry learned in one language isn't served
  // for another. (cached_entries.word is the PK, so only one language's entry
  // per word is retained — a stricter per-language cache needs a schema change.)
  const row = userDb
    .prepare('SELECT word, ipa, etymology FROM cached_entries WHERE word = ? AND language = ?')
    .get(word, language) as CachedEntryRow | undefined;
  if (!row) return undefined;

  const senses = userDb
    .prepare('SELECT pos, gloss FROM cached_senses WHERE word = ? ORDER BY sort_order')
    .all(row.word) as Array<{ pos: string | null; gloss: string }>;
  if (senses.length === 0) return undefined;

  const related = userDb
    .prepare('SELECT related_word, relation FROM cached_related_forms WHERE word = ?')
    .all(row.word) as Array<{ related_word: string; relation: string }>;

  const entry: ExpandedDictionaryEntry = {
    word: row.word,
    senses: senses.map((s) => ({ partOfSpeech: s.pos || '', gloss: s.gloss })),
    source: 'cache',
  };
  if (row.ipa) entry.ipa = row.ipa;
  if (row.etymology) entry.etymology = row.etymology;
  if (related.length) {
    entry.relatedForms = related.map((r) => ({ form: r.related_word, relation: r.relation }));
  }
  return entry;
}

export interface CacheAcceptedInput {
  word: string;
  senses: Array<{ partOfSpeech: string; gloss: string }>;
  ipa?: string;
  etymology?: string;
  relatedForms?: Array<{ form: string; relation: string }>;
  sourceSentence?: string;
  language?: string;
}

/** Persist an accepted AI translation into the on-device cache. Idempotent on word
 *  (upsert replaces senses + related forms). Returns the cached row's word so the
 *  caller can confirm. */
export function cacheAcceptedEntry(input: CacheAcceptedInput): string | null {
  if (!input.word || !input.senses || input.senses.length === 0) return null;
  const word = input.word.toLowerCase();
  const now = new Date().toISOString();
  const language = input.language || 'af';

  const upsertEntry = userDb.prepare(`
    INSERT INTO cached_entries (word, language, ipa, etymology, sourceSentence, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(word) DO UPDATE SET
      language = excluded.language,
      ipa = excluded.ipa,
      etymology = excluded.etymology,
      sourceSentence = excluded.sourceSentence,
      updatedAt = excluded.updatedAt
  `);
  const deleteSenses = userDb.prepare('DELETE FROM cached_senses WHERE word = ?');
  const insertSense = userDb.prepare(
    'INSERT INTO cached_senses (word, pos, gloss, sort_order) VALUES (?, ?, ?, ?)',
  );
  const deleteRelated = userDb.prepare('DELETE FROM cached_related_forms WHERE word = ?');
  const insertRelated = userDb.prepare(
    'INSERT INTO cached_related_forms (word, related_word, relation) VALUES (?, ?, ?)',
  );

  const txn = userDb.transaction(() => {
    upsertEntry.run(
      word,
      language,
      input.ipa ?? null,
      input.etymology ?? null,
      input.sourceSentence ?? null,
      now,
      now,
    );
    deleteSenses.run(word);
    input.senses.forEach((s, i) => {
      if (!s.gloss) return;
      insertSense.run(word, s.partOfSpeech || null, s.gloss, i);
    });
    deleteRelated.run(word);
    (input.relatedForms || []).forEach((r) => {
      if (!r.form || !r.relation) return;
      insertRelated.run(word, r.form, r.relation);
    });
  });
  txn();
  return word;
}

// ---------------------------------------------------------------------------
// lookupWord — exact → inflections → prefix → suffix → affix-strip fallback
// ---------------------------------------------------------------------------

export function lookupWord(
  word: string,
  language: string = getActiveLanguageCode(),
): ExpandedDictionaryEntry | undefined {
  const lower = word.toLowerCase();
  const stmts = getStmts(language);

  // Curated kaikki dict — only available if data/dictionary-<lang>.db is present.
  if (stmts) {
    // 1. Exact match
    const exact = stmts.selectEntry.get(lower) as EntryRow | undefined;
    if (exact) return buildEntry(exact, stmts, lower);

    // 2. Inflection table (e.g. "katte" → "kat", "geword" → "word")
    const infl = stmts.selectInflectionLemma.get(lower) as { lemma: string; type: string | null } | undefined;
    if (infl) {
      const lemmaRow = stmts.selectEntry.get(infl.lemma) as EntryRow | undefined;
      if (lemmaRow) {
        const label = infl.type ? `${infl.type.replace(/,/g, ' ')} form of` : 'inflected form of';
        return buildEntry(lemmaRow, stmts, lower, { stem: lemmaRow.word, label });
      }
    }

    // Steps 3-4 use Afrikaans-specific affix morphology (PREFIXES / SUFFIXES /
    // consonant undoubling). Only apply them for Afrikaans — running them
    // against another language's dictionary would mis-derive stems.
    if (language === 'af') {
      // 3. Known prefix → exact stem
      for (const prefix of PREFIXES) {
        if (!lower.startsWith(prefix)) continue;
        const stem = lower.slice(prefix.length);
        if (stem.length < MIN_STEM) continue;
        const stemRow = stmts.selectEntry.get(stem) as EntryRow | undefined;
        if (stemRow) {
          return buildEntry(stemRow, stmts, lower, { stem, label: PREFIX_LABELS[prefix] });
        }
      }

      // 4. Known suffix → exact stem (with consonant undoubling)
      for (const suffix of SUFFIXES) {
        if (!lower.endsWith(suffix)) continue;
        const stem = lower.slice(0, -suffix.length);
        if (stem.length < MIN_STEM) continue;

        const stemRow = stmts.selectEntry.get(stem) as EntryRow | undefined;
        if (stemRow) {
          return buildEntry(stemRow, stmts, lower, { stem, label: SUFFIX_LABELS[suffix] });
        }

        const undoubled = undoubleConsonant(stem);
        if (undoubled && undoubled.length >= MIN_STEM) {
          const uRow = stmts.selectEntry.get(undoubled) as EntryRow | undefined;
          if (uRow) {
            return buildEntry(uRow, stmts, lower, { stem: undoubled, label: SUFFIX_LABELS[suffix] });
          }
        }
      }
    }
  }

  // 5. AI cache fallthrough — user-accepted translations persisted in lector.db.
  //    Lives behind the curated dict so the kaikki entry always wins, but in
  //    front of the AI translate fallback so previously-seen words don't pay
  //    for the LLM round-trip again.
  const cached = lookupCached(lower, language);
  if (cached) return cached;

  return undefined;
}
