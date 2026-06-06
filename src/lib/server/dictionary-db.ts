import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/**
 * Read-only SQLite-backed Afrikaans dictionary.
 *
 * Built by `scripts/build-dictionary.ts` from the kaikki.org Wiktionary dump
 * (merged with the hand-curated ranks in `src/lib/dictionary-roots.json`).
 * This module mirrors the lookup algorithm in `src/lib/dictionary.ts` —
 * exact → inflections → prefix derivation → suffix derivation → affix-strip
 * fallback — but exposes the richer multi-sense schema available from kaikki.
 */

// The dictionary is read-only application data shipped with the image.
// Prefer DICT_DIR so it stays put when the user mounts a volume on DATA_DIR
// for their (mutable) collections/vocab data. Fall back to DATA_DIR for local
// dev (where the build script writes here) and finally to ./data.
function getDbPath(): string {
  const dir = process.env.DICT_DIR || process.env.DATA_DIR || './data';
  return path.join(dir, 'dictionary-af.db');
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
}

// ---------------------------------------------------------------------------
// Lazy connection (mirrors src/lib/server/database.ts pattern)
// ---------------------------------------------------------------------------

let _db: DatabaseType | null = null;

function getDb(): DatabaseType | null {
  if (_db) return _db;
  if (!fs.existsSync(getDbPath())) {
    // The dictionary DB is optional at runtime — callers fall back to the
    // legacy JSON dict + the AI translate API when this file isn't present.
    return null;
  }
  _db = new Database(getDbPath(), { readonly: true, fileMustExist: true });
  _db.pragma('journal_mode = WAL');
  return _db;
}

// Exposed as a proxy so consumers can `import { dictDb }` and the DB opens
// lazily on first access — same shape as `db` in src/lib/server/database.ts.
export const dictDb = new Proxy({} as DatabaseType, {
  get(_target, prop) {
    const real = getDb();
    if (!real) {
      throw new Error(
        `Dictionary database not found at ${getDbPath()}. ` +
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

let _stmts: Stmts | null = null;

function getStmts(): Stmts | null {
  if (_stmts) return _stmts;
  const db = getDb();
  if (!db) return null;
  _stmts = {
    selectEntry: db.prepare('SELECT word, rank, ipa, etymology FROM entries WHERE word = ?'),
    selectSenses: db.prepare('SELECT pos, gloss FROM senses WHERE word = ? ORDER BY sort_order'),
    selectRelated: db.prepare('SELECT related_word, relation FROM related_forms WHERE word = ?'),
    selectInflectionLemma: db.prepare('SELECT lemma, type FROM inflections WHERE inflected_form = ? LIMIT 1'),
  };
  return _stmts;
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
  };
  if (row.rank != null) entry.rank = row.rank;
  if (row.ipa) entry.ipa = row.ipa;
  if (row.etymology) entry.etymology = row.etymology;
  if (related.length) entry.relatedForms = related;
  if (lemmaInfo) entry.lemmaInfo = lemmaInfo;
  return entry;
}

// ---------------------------------------------------------------------------
// lookupWord — exact → inflections → prefix → suffix → affix-strip fallback
// ---------------------------------------------------------------------------

export function lookupWord(word: string): ExpandedDictionaryEntry | undefined {
  const stmts = getStmts();
  if (!stmts) return undefined;
  const lower = word.toLowerCase();

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

  return undefined;
}
