import { Database, type Statement } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import { db as userDb } from '../db';
import {
  arabicLooseKey,
  DEFAULT_LANGUAGE,
  foldWord,
  getLanguageConfig,
  hebrewLooseKey,
  isValidLanguageCode,
  latinLookupVariants,
  stripMarks,
} from './languages';
import { esperantoIpa } from '../../../languages/eo/ipa';
import { stemCandidates } from '../../../languages/morphology';
import { analyseJapanese } from './ja-morphology';
import { acceptedDictionaryContentBytes } from './storage-limits';

// x-system fold (#307 §3.4): learners without an Esperanto keyboard type
// cx/gx/hx/jx/sx/ux for the supersignoj (ĉ ĝ ĥ ĵ ŝ ŭ). Folded at the lookup
// boundary ONLY — storage and display keep proper orthography. The digraphs
// are unambiguous because x is not an Esperanto letter. (The h-system is NOT
// folded: h is a real letter, and words like "flughaveno" contain a true g+h.)
const EO_X_DIGRAPHS: Record<string, string> = {
  cx: 'ĉ',
  gx: 'ĝ',
  hx: 'ĥ',
  jx: 'ĵ',
  sx: 'ŝ',
  ux: 'ŭ',
};

// Dictionary keys are folded via the language pack (#289): NFC + case fold,
// matching how the reader folds words before lookups.
function foldKey(word: string, language: string): string {
  const pack = getLanguageConfig(isValidLanguageCode(language) ? language : DEFAULT_LANGUAGE);
  const folded = foldWord(word, pack);
  if (language === 'eo' && folded.includes('x')) {
    return folded.replace(/[cghjsu]x/gu, (digraph) => EO_X_DIGRAPHS[digraph] ?? digraph);
  }
  return folded;
}

/**
 * Read-only SQLite-backed bilingual dictionary, selected by the active language.
 * This file is the only implementation. The `src/lib/server/dictionary-db.ts`
 * mirror it was ported from went away with the Hono/Bun replatform (#180).
 *
 * Built by `scripts/build-dictionary.ts` from the kaikki.org Wiktionary dump.
 * Lookup order: exact → inflections → prefix → suffix → affix-strip fallback,
 * then the AI cache (lector.db). The affix heuristics are Afrikaans-specific.
 */

// A dictionary is read-only to THIS module: every connection below opens with
// immutable=1. The files are no longer shipped with the image, though. The
// runtime downloads them into DICT_DIR (#438, dict-install.ts), which is why
// that directory needs a volume of its own and why a download must invalidate
// the caches below rather than assume the set never changes.
//
// Prefer DICT_DIR so the dictionaries stay put when the user mounts a volume on
// DATA_DIR for their own data; fall back to DATA_DIR, then '../data'. The default mirrors
// db.ts (which also defaults to '../data') because the API runs from ./api in
// local dev (`cd api && bun run …`) — a bare './data' resolved to the
// nonexistent ./api/data, so every dictionary lookup silently missed and every
// word fell through to the (slow) AI path.
export function dictionaryDir(): string {
  return process.env.DICT_DIR || process.env.DATA_DIR || '../data';
}

export function dictionaryPath(language: string): string {
  return path.join(dictionaryDir(), `dictionary-${language}.db`);
}

function getDbPath(language: string): string {
  return dictionaryPath(language);
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
  /** `dict` = built-in kaikki dict; `cache` = user-learned AI translation. */
  source?: 'dict' | 'cache';
}

// ---------------------------------------------------------------------------
// Lazy per-language connection (the API process is long-lived)
// ---------------------------------------------------------------------------

// A cached `null` records "no dict file for this language" so we don't re-stat.
const _dbs = new Map<string, Database | null>();

function getDb(language: string): Database | null {
  const cached = _dbs.get(language);
  if (cached !== undefined) return cached;

  const dbPath = getDbPath(language);
  if (!fs.existsSync(dbPath)) {
    // The dictionary DB is optional at runtime — callers fall back to the AI
    // cache + the AI translate API when this file isn't present.
    _dbs.set(language, null);
    return null;
  }

  try {
    // The build stamps the artifact WAL (scripts/build-dictionary.ts), and
    // bun:sqlite cannot open a WAL database read-only without a writable
    // -shm/-wal sidecar (which isn't shipped) — a plain `{ readonly: true }`
    // open throws SQLITE_CANTOPEN. The `immutable=1` URI tells SQLite the file
    // can't change, so it reads pages directly and skips WAL/-shm entirely.
    //
    // Pass raw flags SQLITE_OPEN_READONLY (0x01) | SQLITE_OPEN_URI (0x40), NOT
    // `{ readonly: true }`: the object form relied on bun auto-detecting the
    // `file:` scheme to enable URI parsing, which doesn't hold on CI's bun (it
    // treated the URI as a literal path → CANTOPEN). The explicit URI flag
    // forces SQLite to parse `immutable=1`. (better-sqlite3 tolerated the plain
    // read-only open of a WAL DB; bun:sqlite is stricter.)
    const conn = new Database(`file:${path.resolve(dbPath)}?immutable=1`, 0x01 | 0x40);
    _dbs.set(language, conn);
    return conn;
  } catch (err) {
    // Any open failure degrades to the AI-translate fallback rather than
    // throwing — a thrown error here would 500 every lookup. The dictionary is
    // optional at runtime, so a missing/unreadable DB just means "no curated hit".
    console.warn(`Dictionary unavailable for "${language}" at ${dbPath}:`, err);
    _dbs.set(language, null);
    return null;
  }
}

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
// Esperanto rule-based morphology (#307 §3.3) — deterministic, not heuristic
// ---------------------------------------------------------------------------
// Unlike the Afrikaans affix rules above (a best-effort heuristic), Esperanto
// morphology is algorithmic and exhaustive: POS is encoded in the ending
// (-o noun, -a adjective, -e adverb, -i/-as/-is/-os/-us/-u verb), the
// grammatical endings -j (plural) and -n (accusative) strip cleanly, and
// derivation uses a closed, documented affix set. That lets the analyzer
// out-cover kaikki on productive compounds (malsanulejo = mal+san+ul+ej+o)
// while staying exact. Every path below still only returns a real dictionary
// row — the rules generate candidates, the dictionary decides.

const EO_FINITE_VERB_LABELS: Record<string, string> = {
  as: 'present tense of',
  is: 'past tense of',
  os: 'future tense of',
  us: 'conditional of',
  u: 'imperative of',
};

// Derivational prefixes, matched at the word start.
const EO_PREFIXES = ['mal', 'eks', 'mis', 'dis', 'pra', 'ĉef', 'ek', 'ge', 're', 'bo', 'fi'];

// Derivational suffixes (incl. the six participle morphemes), peeled from the
// root end, longest first so -ist wins over -it, -ind over -id.
const EO_SUFFIXES = [
  'estr',
  'ist',
  'ind',
  'ebl',
  'ant',
  'int',
  'ont',
  'aĵ',
  'ec',
  'ej',
  'ul',
  'in',
  'et',
  'eg',
  'il',
  'an',
  'ar',
  'id',
  'em',
  'ig',
  'iĝ',
  'ad',
  'er',
  'um',
  'at',
  'it',
  'ot',
];

// Roots this short are never worth peeling toward (sci- is the shortest
// common root at 3).
const EO_MIN_ROOT = 3;

/**
 * Resolve an Esperanto root against the dictionary by trying each
 * part-of-speech vowel. A root is not a lemma on its own — kaikki lemmas are
 * full words (sano, sana, scii) — so `kur` resolves via kuri/kuro/kura.
 */
function eoResolveRoot(stmts: Stmts, root: string): EntryRow | undefined {
  for (const posVowel of ['o', 'i', 'a', 'e']) {
    const row = stmts.selectEntry.get(root + posVowel) as EntryRow | undefined;
    if (row) return row;
  }
  return undefined;
}

/**
 * Depth-first affix peeling with backtracking: at each step try to resolve
 * the root, else peel a suffix, else peel a prefix. Backtracking matters —
 * greedy peeling dead-ends on words like malsanulejo, where the stem
 * `malsan` superficially ends in the suffix -an but actually carries the
 * prefix mal-. Deterministic (fixed affix order, depth-capped) and every
 * result is a real dictionary row.
 */
function eoPeelToRoot(
  stmts: Stmts,
  root: string,
  depth: number,
  peeled: string[],
): { row: EntryRow; peeled: string[] } | undefined {
  if (root.length < EO_MIN_ROOT) return undefined;
  const row = eoResolveRoot(stmts, root);
  if (row) return { row, peeled };
  if (depth >= 5) return undefined;

  const suffix = EO_SUFFIXES.find((s) => root.endsWith(s) && root.length - s.length >= EO_MIN_ROOT);
  if (suffix) {
    const hit = eoPeelToRoot(stmts, root.slice(0, -suffix.length), depth + 1, [
      ...peeled,
      `-${suffix}-`,
    ]);
    if (hit) return hit;
  }
  const prefix = EO_PREFIXES.find(
    (p) => root.startsWith(p) && root.length - p.length >= EO_MIN_ROOT,
  );
  if (prefix) {
    const hit = eoPeelToRoot(stmts, root.slice(prefix.length), depth + 1, [
      ...peeled,
      `${prefix}-`,
    ]);
    if (hit) return hit;
  }
  return undefined;
}

function eoLookupByRule(stmts: Stmts, lower: string): ExpandedDictionaryEntry | undefined {
  // 1. Grammatical endings on nominals and correlatives: belajn → bela,
  //    domojn → domo, tiujn → tiu, min → mi. Exact-base matches only.
  const grammatical: Array<[string, string]> = [
    ['jn', 'accusative plural of'],
    ['j', 'plural of'],
    ['n', 'accusative of'],
  ];
  for (const [ending, label] of grammatical) {
    if (lower.endsWith(ending) && lower.length - ending.length >= MIN_STEM) {
      const base = lower.slice(0, -ending.length);
      const row = stmts.selectEntry.get(base) as EntryRow | undefined;
      if (row) return buildEntry(row, stmts, lower, { stem: row.word, label });
    }
  }

  // 2. Finite verb → infinitive (the kaikki lemma): parolas → paroli.
  for (const [ending, label] of Object.entries(EO_FINITE_VERB_LABELS)) {
    if (lower.endsWith(ending) && lower.length - ending.length >= MIN_STEM) {
      const infinitive = lower.slice(0, -ending.length) + 'i';
      const row = stmts.selectEntry.get(infinitive) as EntryRow | undefined;
      if (row) return buildEntry(row, stmts, lower, { stem: row.word, label });
    }
  }

  // 3. Derived adverb → its adjective/noun source: rapide → rapida,
  //    hejme → hejmo.
  if (lower.endsWith('e') && lower.length - 1 >= MIN_STEM) {
    for (const posVowel of ['a', 'o']) {
      const row = stmts.selectEntry.get(lower.slice(0, -1) + posVowel) as EntryRow | undefined;
      if (row) {
        return buildEntry(row, stmts, lower, { stem: row.word, label: 'adverbial form of' });
      }
    }
  }

  // 4. Productive derivation: strip the grammatical + POS endings down to the
  //    root, then peel derivational affixes until a dictionary word resolves
  //    (malsanulejo → malsanulej → [ej] malsanul → [ul] malsan → [mal] san →
  //    sano). Each peel is only accepted if the eventual stem is a real entry.
  let stem = lower;
  if (stem.endsWith('n')) stem = stem.slice(0, -1);
  if (stem.endsWith('j')) stem = stem.slice(0, -1);
  if (/(?:as|is|os|us)$/u.test(stem) && stem === lower) {
    stem = stem.slice(0, -2);
  } else if (/[oaieu]$/u.test(stem)) {
    stem = stem.slice(0, -1);
  } else {
    return undefined; // not shaped like an Esperanto word form
  }

  const hit = eoPeelToRoot(stmts, stem, 0, []);
  if (hit && hit.row.word !== lower) {
    const label = hit.peeled.length
      ? `${hit.peeled.reverse().join(' + ')} form of`
      : 'derived from';
    return buildEntry(hit.row, stmts, lower, { stem: hit.row.word, label });
  }

  // 5. Root compounds resolve to their head — the final root (vaporŝipo →
  //    ŝipo). Longest tail wins; ≥4 chars including the POS vowel keeps junk
  //    matches out.
  const compoundSource = lower.replace(/(?:jn|j|n)$/u, '');
  for (let i = 1; i <= compoundSource.length - 4; i++) {
    const tail = compoundSource.slice(i);
    const row = stmts.selectEntry.get(tail) as EntryRow | undefined;
    if (row) return buildEntry(row, stmts, lower, { stem: row.word, label: 'compound ending in' });
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers (cached per connection)
// ---------------------------------------------------------------------------

type Stmts = {
  selectEntry: Statement;
  selectSenses: Statement;
  selectRelated: Statement;
  selectInflectionLemma: Statement;
  selectReadings: Statement;
};

const _stmtsByLang = new Map<string, Stmts>();

/**
 * Forget both caches for one language (#438).
 *
 * `getDb` caches a `null` when the file is absent, so a dictionary that arrives
 * after the first lookup stays invisible until a restart. The runtime installer
 * calls this when a download lands.
 *
 * It drops the entries and does NOT close the old connection. A request can
 * hold that connection mid-lookup, and closing it under the request crashes the
 * query. The installer renames the new file into place, so an open handle keeps
 * reading the old inode until the garbage collector takes it. The next lookup
 * opens the new file.
 */
export function invalidateDictionaryCache(language: string): void {
  _dbs.delete(language);
  _stmtsByLang.delete(language);
}

function getStmts(language: string): Stmts | null {
  const cached = _stmtsByLang.get(language);
  if (cached) return cached;
  const db = getDb(language);
  if (!db) return null;
  try {
    const stmts: Stmts = {
      selectEntry: db.prepare('SELECT word, rank, ipa, etymology FROM entries WHERE word = ?'),
      selectSenses: db.prepare('SELECT pos, gloss FROM senses WHERE word = ? ORDER BY sort_order'),
      selectRelated: db.prepare('SELECT related_word, relation FROM related_forms WHERE word = ?'),
      // Several lemmas can claim one surface form (kaikki paradigm tables
      // attach shared cells like the bare article to unrelated lemmas — grc
      // τὸν is claimed by ὁ AND -κτόνος). Prefer the most frequent lemma by
      // entry rank; unranked dictionaries (rank all NULL) keep insertion
      // order, and the JOIN also skips rows whose lemma has no entry.
      selectInflectionLemma: db.prepare(
        `SELECT i.lemma, i.type FROM inflections i
         JOIN entries e ON e.word = i.lemma
         WHERE i.inflected_form = ?
         ORDER BY (e.rank IS NULL), e.rank, i.rowid LIMIT 1`,
      ),
      // Batch pronunciation reader for the annotation layer (#289 4.4). One
      // statement for the whole page, driven by a JSON array of folded keys.
      //
      // The alias arm is not an optimisation, it is required. zh entries are
      // keyed on the Simplified form, so a Traditional headword — and some
      // Simplified ones — exist only in `inflections` with type 'headword'.
      // 你好 is not a row in `entries` at all. Without the second COALESCE arm
      // a 500-word sample returned 434 readings; with it, 443, and an
      // alias-only sample went from 0 to 97.
      //
      // Both arms hit an index: entries.word is the PRIMARY KEY, and
      // inflections is covered by its (inflected_form, lemma) autoindex. The
      // inflection arm repeats the ORDER BY of selectInflectionLemma so a
      // surface form claimed by several lemmas resolves identically either way.
      selectReadings: db.prepare(
        `SELECT k.value AS word,
                COALESCE(
                  (SELECT e.ipa FROM entries e WHERE e.word = k.value),
                  (SELECT e2.ipa FROM inflections i
                     JOIN entries e2 ON e2.word = i.lemma
                    WHERE i.inflected_form = k.value
                    ORDER BY (e2.rank IS NULL), e2.rank, i.rowid LIMIT 1)
                ) AS ipa
           FROM json_each(?) k
          WHERE ipa IS NOT NULL`,
      ),
    };
    _stmtsByLang.set(language, stmts);
    return stmts;
  } catch (err) {
    // A corrupt/incompatible dict (opens but the expected tables are missing)
    // degrades to the AI fallback rather than 500ing every lookup.
    console.warn(`Dictionary unusable for "${language}":`, err);
    return null;
  }
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
  lookupWordValue: string,
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
    word: lookupWordValue,
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
// AI cache (lector.db) — entries the user "accepted". Read AFTER the curated
// dict misses on every lookup path so coverage of the user's corpus grows.
// ---------------------------------------------------------------------------

interface CachedEntryRow {
  word: string;
  ipa: string | null;
  etymology: string | null;
}

function lookupCached(
  userId: string,
  word: string,
  language: string,
): ExpandedDictionaryEntry | undefined {
  const row = userDb
    .prepare(
      'SELECT word, ipa, etymology FROM cached_entries WHERE userId = ? AND word = ? AND language = ?',
    )
    .get(userId, word, language) as CachedEntryRow | undefined;
  if (!row) return undefined;

  const senses = userDb
    .prepare(
      'SELECT pos, gloss FROM cached_senses WHERE userId = ? AND word = ? AND language = ? ORDER BY sort_order',
    )
    .all(userId, row.word, language) as Array<{ pos: string | null; gloss: string }>;
  if (senses.length === 0) return undefined;

  const related = userDb
    .prepare(
      'SELECT related_word, relation FROM cached_related_forms WHERE userId = ? AND word = ? AND language = ?',
    )
    .all(userId, row.word, language) as Array<{ related_word: string; relation: string }>;

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
  language: string;
}

export type CacheAcceptedValidation =
  | { ok: true; value: CacheAcceptedInput }
  | { ok: false; error: string };

export const CACHE_ACCEPTED_LIMITS = {
  word: 128,
  senses: 20,
  partOfSpeech: 64,
  gloss: 512,
  ipa: 256,
  etymology: 2_000,
  sourceSentence: 2_000,
  relatedForms: 50,
  relatedValue: 128,
} as const;

function optionalString(
  value: unknown,
  label: string,
  maxLength: number,
): { ok: true; value?: string } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true };
  if (typeof value !== 'string') return { ok: false, error: `${label} must be a string` };
  if (value.length > maxLength) {
    return { ok: false, error: `${label} must be at most ${maxLength} characters` };
  }
  return { ok: true, value };
}

/** Validate the complete public/restore cache contract before any SQL write. */
export function validateCacheAcceptedInput(value: unknown): CacheAcceptedValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'Dictionary entry must be an object' };
  }
  const input = value as Record<string, unknown>;
  if (typeof input.word !== 'string' || input.word.trim().length === 0) {
    return { ok: false, error: 'Word is required' };
  }
  if (input.word.length > CACHE_ACCEPTED_LIMITS.word) {
    return {
      ok: false,
      error: `Word must be at most ${CACHE_ACCEPTED_LIMITS.word} characters`,
    };
  }
  if (typeof input.language !== 'string' || !isValidLanguageCode(input.language)) {
    return { ok: false, error: 'Language is required' };
  }
  if (
    !Array.isArray(input.senses) ||
    input.senses.length < 1 ||
    input.senses.length > CACHE_ACCEPTED_LIMITS.senses
  ) {
    return {
      ok: false,
      error: `Senses must contain between 1 and ${CACHE_ACCEPTED_LIMITS.senses} entries`,
    };
  }

  const senses: CacheAcceptedInput['senses'] = [];
  for (const candidate of input.senses) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return { ok: false, error: 'Each sense must be an object' };
    }
    const sense = candidate as Record<string, unknown>;
    if (
      typeof sense.partOfSpeech !== 'string' ||
      sense.partOfSpeech.length > CACHE_ACCEPTED_LIMITS.partOfSpeech
    ) {
      return {
        ok: false,
        error: `Each part of speech must be a string of at most ${CACHE_ACCEPTED_LIMITS.partOfSpeech} characters`,
      };
    }
    if (
      typeof sense.gloss !== 'string' ||
      sense.gloss.trim().length === 0 ||
      sense.gloss.length > CACHE_ACCEPTED_LIMITS.gloss
    ) {
      return {
        ok: false,
        error: `Each gloss must contain 1 to ${CACHE_ACCEPTED_LIMITS.gloss} characters`,
      };
    }
    senses.push({ partOfSpeech: sense.partOfSpeech, gloss: sense.gloss });
  }

  const ipa = optionalString(input.ipa, 'IPA', CACHE_ACCEPTED_LIMITS.ipa);
  if (!ipa.ok) return ipa;
  const etymology = optionalString(input.etymology, 'Etymology', CACHE_ACCEPTED_LIMITS.etymology);
  if (!etymology.ok) return etymology;
  const sourceSentence = optionalString(
    input.sourceSentence,
    'Source sentence',
    CACHE_ACCEPTED_LIMITS.sourceSentence,
  );
  if (!sourceSentence.ok) return sourceSentence;

  if (
    input.relatedForms !== undefined &&
    (!Array.isArray(input.relatedForms) ||
      input.relatedForms.length > CACHE_ACCEPTED_LIMITS.relatedForms)
  ) {
    return {
      ok: false,
      error: `Related forms must be an array of at most ${CACHE_ACCEPTED_LIMITS.relatedForms} entries`,
    };
  }
  const relatedForms: NonNullable<CacheAcceptedInput['relatedForms']> = [];
  for (const candidate of (input.relatedForms as unknown[] | undefined) ?? []) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return { ok: false, error: 'Each related form must be an object' };
    }
    const related = candidate as Record<string, unknown>;
    if (
      typeof related.form !== 'string' ||
      related.form.trim().length === 0 ||
      related.form.length > CACHE_ACCEPTED_LIMITS.relatedValue ||
      typeof related.relation !== 'string' ||
      related.relation.trim().length === 0 ||
      related.relation.length > CACHE_ACCEPTED_LIMITS.relatedValue
    ) {
      return {
        ok: false,
        error: `Each related form and relation must contain 1 to ${CACHE_ACCEPTED_LIMITS.relatedValue} characters`,
      };
    }
    relatedForms.push({ form: related.form, relation: related.relation });
  }

  return {
    ok: true,
    value: {
      word: input.word.trim(),
      language: input.language,
      senses,
      ...(ipa.value === undefined ? {} : { ipa: ipa.value }),
      ...(etymology.value === undefined ? {} : { etymology: etymology.value }),
      ...(sourceSentence.value === undefined ? {} : { sourceSentence: sourceSentence.value }),
      ...(relatedForms.length === 0 ? {} : { relatedForms }),
    },
  };
}

/**
 * Old cache rows predate the public write bounds above. Keep takeouts
 * restore-ready by retaining the usable entry and clipping only derived
 * teaching metadata; an invalid identity (word/language) or an entry with no
 * usable sense is omitted instead of making the user's entire backup fail.
 */
export function sanitizeLegacyCacheAcceptedInput(value: unknown): CacheAcceptedInput | null {
  const current = validateCacheAcceptedInput(value);
  if (current.ok) return current.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const input = value as Record<string, unknown>;
  if (
    typeof input.word !== 'string' ||
    input.word.trim().length === 0 ||
    input.word.length > CACHE_ACCEPTED_LIMITS.word ||
    typeof input.language !== 'string' ||
    !isValidLanguageCode(input.language) ||
    !Array.isArray(input.senses)
  ) {
    return null;
  }

  const senses = input.senses
    .slice(0, CACHE_ACCEPTED_LIMITS.senses)
    .flatMap((candidate): CacheAcceptedInput['senses'] => {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        return [];
      }
      const sense = candidate as Record<string, unknown>;
      if (typeof sense.gloss !== 'string' || sense.gloss.trim().length === 0) return [];
      return [
        {
          partOfSpeech:
            typeof sense.partOfSpeech === 'string'
              ? sense.partOfSpeech.slice(0, CACHE_ACCEPTED_LIMITS.partOfSpeech)
              : '',
          gloss: sense.gloss.trim().slice(0, CACHE_ACCEPTED_LIMITS.gloss),
        },
      ];
    });
  if (senses.length === 0) return null;

  const optional = (candidate: unknown, maxLength: number): string | undefined =>
    typeof candidate === 'string' && candidate.length > 0
      ? candidate.slice(0, maxLength)
      : undefined;
  const ipa = optional(input.ipa, CACHE_ACCEPTED_LIMITS.ipa);
  const etymology = optional(input.etymology, CACHE_ACCEPTED_LIMITS.etymology);
  const sourceSentence = optional(input.sourceSentence, CACHE_ACCEPTED_LIMITS.sourceSentence);
  const relatedForms = Array.isArray(input.relatedForms)
    ? input.relatedForms
        .slice(0, CACHE_ACCEPTED_LIMITS.relatedForms)
        .flatMap((candidate): NonNullable<CacheAcceptedInput['relatedForms']> => {
          if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
            return [];
          }
          const related = candidate as Record<string, unknown>;
          if (
            typeof related.form !== 'string' ||
            related.form.trim().length === 0 ||
            typeof related.relation !== 'string' ||
            related.relation.trim().length === 0
          ) {
            return [];
          }
          return [
            {
              form: related.form.trim().slice(0, CACHE_ACCEPTED_LIMITS.relatedValue),
              relation: related.relation.trim().slice(0, CACHE_ACCEPTED_LIMITS.relatedValue),
            },
          ];
        })
    : [];

  const candidate: CacheAcceptedInput = {
    word: input.word.trim(),
    language: input.language,
    senses,
    ...(ipa === undefined ? {} : { ipa }),
    ...(etymology === undefined ? {} : { etymology }),
    ...(sourceSentence === undefined ? {} : { sourceSentence }),
    ...(relatedForms.length === 0 ? {} : { relatedForms }),
  };
  const sanitized = validateCacheAcceptedInput(candidate);
  return sanitized.ok ? sanitized.value : null;
}

/** Persist an accepted AI translation into the on-device cache. Idempotent on
 *  word (upsert replaces senses + related forms). Returns the cached word. */
export function cacheAcceptedEntry(userId: string, input: CacheAcceptedInput): string | null {
  const validated = validateCacheAcceptedInput(input);
  if (!validated.ok) return null;
  input = validated.value;
  const language = input.language;
  const word = foldKey(input.word, language);
  const now = new Date().toISOString();

  const upsertEntry = userDb.prepare(`
    INSERT INTO cached_entries
      (userId, word, language, ipa, etymology, sourceSentence, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(userId, word, language) DO UPDATE SET
      ipa = excluded.ipa,
      etymology = excluded.etymology,
      sourceSentence = excluded.sourceSentence,
      updatedAt = excluded.updatedAt
  `);
  const deleteSenses = userDb.prepare(
    'DELETE FROM cached_senses WHERE userId = ? AND word = ? AND language = ?',
  );
  const insertSense = userDb.prepare(
    'INSERT INTO cached_senses (userId, word, language, pos, gloss, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const deleteRelated = userDb.prepare(
    'DELETE FROM cached_related_forms WHERE userId = ? AND word = ? AND language = ?',
  );
  const insertRelated = userDb.prepare(
    'INSERT INTO cached_related_forms (userId, word, language, related_word, relation) VALUES (?, ?, ?, ?, ?)',
  );

  userDb.transaction(() => {
    upsertEntry.run(
      userId,
      word,
      language,
      input.ipa ?? null,
      input.etymology ?? null,
      input.sourceSentence ?? null,
      now,
      now,
    );
    deleteSenses.run(userId, word, language);
    input.senses.forEach((s, i) => {
      if (!s.gloss) return;
      insertSense.run(userId, word, language, s.partOfSpeech || null, s.gloss, i);
    });
    deleteRelated.run(userId, word, language);
    (input.relatedForms || []).forEach((r) => {
      if (!r.form || !r.relation) return;
      insertRelated.run(userId, word, language, r.form, r.relation);
    });
  })();
  return word;
}

export function acceptedCacheIdentity(input: CacheAcceptedInput): {
  word: string;
  language: string;
} {
  return { word: foldKey(input.word, input.language), language: input.language };
}

/** Exact UTF-8 TEXT bytes this accepted entry contributes across its parent,
 * senses, and related forms. Mirrors the aggregate SQL in entitlements.ts. */
export function acceptedCacheContentBytes(input: CacheAcceptedInput): number {
  const { word } = acceptedCacheIdentity(input);
  return acceptedDictionaryContentBytes({ ...input, word });
}

export function storedAcceptedCacheContentBytes(
  userId: string,
  word: string,
  language: string,
): number {
  const parent = userDb
    .prepare(
      `SELECT
         length(CAST(word AS BLOB)) + length(CAST(COALESCE(ipa, '') AS BLOB)) +
         length(CAST(COALESCE(etymology, '') AS BLOB)) +
         length(CAST(COALESCE(sourceSentence, '') AS BLOB)) AS bytes
       FROM cached_entries WHERE userId = ? AND word = ? AND language = ?`,
    )
    .get(userId, word, language) as { bytes: number } | undefined;
  if (!parent) return 0;
  const senses = userDb
    .prepare(
      `SELECT COALESCE(SUM(
         length(CAST(COALESCE(pos, '') AS BLOB)) + length(CAST(gloss AS BLOB))
       ), 0) AS bytes FROM cached_senses
       WHERE userId = ? AND word = ? AND language = ?`,
    )
    .get(userId, word, language) as { bytes: number };
  const related = userDb
    .prepare(
      `SELECT COALESCE(SUM(
         length(CAST(related_word AS BLOB)) + length(CAST(relation AS BLOB))
       ), 0) AS bytes FROM cached_related_forms
       WHERE userId = ? AND word = ? AND language = ?`,
    )
    .get(userId, word, language) as { bytes: number };
  return parent.bytes + senses.bytes + related.bytes;
}

// ---------------------------------------------------------------------------
// lookupWord — exact → inflections → prefix → suffix → affix-strip → AI cache
// ---------------------------------------------------------------------------

export function lookupWord(
  userId: string,
  word: string,
  language: string,
): ExpandedDictionaryEntry | undefined {
  const entry = resolveWord(userId, word, language);

  // Esperanto pronunciation is a pure function of the spelling (the pack's
  // `gloss: 'ipa'` capability, #307 §3.2b), so every hit carries the rule IPA
  // of the SURFACE form the user looked up — more accurate for inflected and
  // compound lookups than the lemma's dictionary transcription, and it also
  // covers AI-cache entries and forms kaikki never enumerated.
  if (entry && language === 'eo') {
    const ipa = esperantoIpa(foldKey(word, language));
    if (ipa) entry.ipa = ipa;
  }
  return entry;
}

/**
 * Drop the transcription delimiters an IPA string carries.
 *
 * `//` marks a phonemic transcription and `[]` a phonetic one. Both belong in a
 * dictionary entry, and the translation drawer keeps them. Above a word in the
 * reader they are noise on every single word, so the annotation layer prints
 * `ˈdomo` and not `/ˈdomo/`. Pinyin carries no delimiters, so this does nothing
 * to a Chinese reading.
 */
function stripTranscriptionDelimiters(ipa: string): string {
  const trimmed = ipa.trim();
  const paired =
    (trimmed.startsWith('/') && trimmed.endsWith('/')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
  // Length 2 or less would be the delimiters alone, and slicing would empty it.
  if (!paired || trimmed.length <= 2) return trimmed;
  return trimmed.slice(1, -1).trim();
}

/**
 * Pronunciation for MANY words at once, for the reader's annotation layer
 * (#289 4.4). Keyed by the FOLDED form, which is what the reader looks up.
 *
 * Deliberately not `lookupWord` in a loop. That path always reads every sense
 * and every related form — `related_forms` averages 55 rows per zh word and
 * peaks at 3,549 — so 500 words cost 7.8 ms of SQL and serialise to 265 KB
 * where the readings alone are 13 KB. This is one statement, measured at
 * 0.53 ms warm for 500 keys against the shipped 65 MB zh dictionary.
 *
 * It also skips the AI-cache fallthrough on a miss. An annotation is a nicety,
 * so a word with no dictionary reading simply gets none, and the reader renders
 * it bare rather than paying up to three extra queries per miss.
 */
export function lookupReadings(words: readonly string[], language: string): Map<string, string> {
  const readings = new Map<string, string>();
  if (words.length === 0) return readings;

  // A pack can require a word to look a certain way before it earns an
  // annotation. ja asks for a kanji: kana already shows its own reading, and
  // several single kana are archaic kanji-words in the dictionary, so looking
  // one up returns something unrelated. を came back as あく and ます as もうす.
  const pack = getLanguageConfig(isValidLanguageCode(language) ? language : DEFAULT_LANGUAGE);
  const requires = pack.pronunciation.annotationRequires;
  const requirePattern = requires ? new RegExp(requires, 'u') : null;

  // Fold first, then de-duplicate. A page repeats words heavily, and the folded
  // key is what both the query and the reader use.
  const keys = new Set<string>();
  for (const word of words) {
    const key = foldKey(word, language);
    if (!key) continue;
    if (requirePattern && !requirePattern.test(key)) continue;
    keys.add(key);
  }
  if (keys.size === 0) return readings;

  const stmts = getStmts(language);
  if (!stmts) return readings;
  try {
    const rows = stmts.selectReadings.all(JSON.stringify([...keys])) as Array<{
      word: string;
      ipa: string;
    }>;
    for (const row of rows) {
      const reading = stripTranscriptionDelimiters(row.ipa);
      if (reading) readings.set(row.word, reading);
    }
  } catch (err) {
    // A missing or unreadable dictionary must not break the reader: the page
    // renders without annotations instead.
    console.warn(`[dictionary] batch readings failed for ${language}:`, err);
  }
  return readings;
}

// kaikki tags a form it could not classify as `error-unrecognized-form`, and a
// tagless form as `form`. Neither is a grammatical description, so neither
// belongs in the reader's "… form of <lemma>" label. Turkish has 28k of the
// error-tagged rows (real forms with an unparsed tag, e.g. ekip → ekmek), which
// is what made this visible; af/de carry a few hundred between them.
const OPAQUE_INFLECTION_TAGS = new Set(['form', 'error-unrecognized-form']);

function inflectionLabel(type: string | null): string {
  if (!type || OPAQUE_INFLECTION_TAGS.has(type)) return 'inflected form of';
  return `${type.replace(/,/g, ' ')} form of`;
}

function resolveWord(
  userId: string,
  word: string,
  language: string,
): ExpandedDictionaryEntry | undefined {
  const lower = foldKey(word, language);
  const stmts = getStmts(language);

  if (stmts) {
    // 1. Exact match
    const exact = stmts.selectEntry.get(lower) as EntryRow | undefined;
    if (exact) return buildEntry(exact, stmts, lower);

    // 1b. Trailing apostrophe (it: po' / de' / va' / da'). The tokenizer
    // never emits a joiner at a token edge, so the reader token is `po`
    // while kaikki (and a rebuilt letterClass) keys `po'`.
    if (!lower.endsWith("'")) {
      const clipped = stmts.selectEntry.get(`${lower}'`) as EntryRow | undefined;
      if (clipped) {
        return buildEntry(clipped, stmts, lower, { stem: clipped.word, label: 'form of' });
      }
    }

    // 2. Inflection table (e.g. "katte" → "kat")
    const infl = stmts.selectInflectionLemma.get(lower) as
      | { lemma: string; type: string | null }
      | undefined;
    if (infl) {
      const lemmaRow = stmts.selectEntry.get(infl.lemma) as EntryRow | undefined;
      if (lemmaRow) {
        const label = inflectionLabel(infl.type);
        return buildEntry(lemmaRow, stmts, lower, { stem: lemmaRow.word, label });
      }
    }

    // Step 3-eo: Esperanto's regular morphology resolves by rule (#307 §3.3) —
    // grammatical endings, finite verbs, derived adverbs, then affix peeling
    // for productive compounds kaikki never enumerated.
    if (language === 'eo') {
      const ruled = eoLookupByRule(stmts, lower);
      if (ruled) return ruled;
    }

    // Step 3-grc: accent-insensitive fallback (#254). Running polytonic text
    // systematically disagrees with dictionary keys on marks — most commonly
    // the grave that replaces a word-final acute mid-sentence (τὸν vs τόν).
    // The build registers mark-stripped alias rows in the inflections table
    // (type 'unaccented'); retry both steps with the stripped key. Only after
    // the exact steps missed, so genuine minimal pairs (ἡ/ἥ/ἤ) stay exact.
    //
    // Gated on the LANGUAGE, not on `practiceLeniency` (#253). The two are
    // unrelated: leniency is about what a typed practice answer may omit, and
    // this step needs the `markStrippedAliases` rows, which the grc and el
    // builds write. Reading the practice setting as the trigger silently
    // handed this step to every pack that relaxed its practice input, and for
    // Arabic that was actively wrong. NFD splits ؤ into و + U+0654 and ئ into
    // ي + U+0654, so stripping every \p{M} rewrites the hamza carriers: 817 ar
    // entries change under it and 51 of them land on a DIFFERENT real entry.
    // A lookup of رؤية ("seeing") would have been answered by روية
    // ("deliberation"), and برئ ("to be innocent") by برية ("wild"). ar has its
    // own fallback in step 3-ar, over alias rows built for the two letter pairs
    // Arabic actually confuses.
    if (language === 'grc' || language === 'el') {
      const stripped = stripMarks(lower);
      if (stripped !== lower) {
        const exactStripped = stmts.selectEntry.get(stripped) as EntryRow | undefined;
        if (exactStripped) return buildEntry(exactStripped, stmts, lower);
        const inflStripped = stmts.selectInflectionLemma.get(stripped) as
          | { lemma: string; type: string | null }
          | undefined;
        if (inflStripped) {
          const lemmaRow = stmts.selectEntry.get(inflStripped.lemma) as EntryRow | undefined;
          if (lemmaRow) {
            const label =
              inflStripped.type && inflStripped.type !== 'unaccented'
                ? `${inflStripped.type.replace(/,/g, ' ')} form of`
                : 'form of';
            return buildEntry(lemmaRow, stmts, lower, { stem: lemmaRow.word, label });
          }
        }
      }
    }

    // Step 3-ar: loose-spelling fallback (#253). Two letter pairs are confused
    // in real Arabic text and never in a dictionary: ta marbuta against ha
    // (مدرسة typed مدرسه) and alef maqsura against ya (على typed علي, في typed
    // فى). The build registers arabicLooseKey of every key as an alias row
    // (type 'unpointed'); retry both steps with the loose key.
    //
    // Only after the exact steps missed. The fold merges genuine pairs as well
    // as spelling variants, and a dictionary that answers the wrong headword is
    // worse than one that answers nothing.
    if (language === 'ar') {
      const loose = arabicLooseKey(lower);
      if (loose !== lower) {
        const looseExact = stmts.selectEntry.get(loose) as EntryRow | undefined;
        if (looseExact) return buildEntry(looseExact, stmts, lower);
        const looseInfl = stmts.selectInflectionLemma.get(loose) as
          | { lemma: string; type: string | null }
          | undefined;
        if (looseInfl) {
          const lemmaRow = stmts.selectEntry.get(looseInfl.lemma) as EntryRow | undefined;
          if (lemmaRow) {
            const label =
              looseInfl.type && looseInfl.type !== 'unpointed'
                ? `${looseInfl.type.replace(/,/g, ' ')} form of`
                : 'form of';
            return buildEntry(lemmaRow, stmts, lower, { stem: lemmaRow.word, label });
          }
        }
      }
    }

    // Step 3-hbo: final-form fallback (#255). Running text and typed input
    // mix ך/כ ם/מ ן/נ ף/פ ץ/צ. The build registers hebrewLooseKey of every
    // key as an alias (type 'unpointed'); retry both steps with the loose key.
    // Only after the exact steps missed, so מלך keeps its own entry.
    if (language === 'hbo') {
      const loose = hebrewLooseKey(lower);
      if (loose !== lower) {
        const looseExact = stmts.selectEntry.get(loose) as EntryRow | undefined;
        if (looseExact) return buildEntry(looseExact, stmts, lower);
        const looseInfl = stmts.selectInflectionLemma.get(loose) as
          | { lemma: string; type: string | null }
          | undefined;
        if (looseInfl) {
          const lemmaRow = stmts.selectEntry.get(looseInfl.lemma) as EntryRow | undefined;
          if (lemmaRow) {
            const label =
              looseInfl.type && looseInfl.type !== 'unpointed'
                ? `${looseInfl.type.replace(/,/g, ' ')} form of`
                : 'form of';
            return buildEntry(lemmaRow, stmts, lower, { stem: lemmaRow.word, label });
          }
        }
      }
      // Maqaf joins two lexemes into one reader token. The compound is not a
      // headword. The host is last. Resolve each part after the compound
      // itself missed; recursion is safe because a part has no maqaf.
      if (lower.includes('\u05BE')) {
        const parts = lower.split('\u05BE').filter((part) => part.length > 0);
        for (const part of parts.reverse()) {
          const host = resolveWord(userId, part, language);
          if (host) return host;
        }
      }
    }

    // Step 3-la: edition-variant fallback (#256). Running Latin mixes u/v and
    // i/j (uult/vult, iam/jam). Try the swapped keys only after the exact
    // and mark-stripped steps miss, so a genuine headword still wins first.
    if (language === 'la') {
      for (const variant of latinLookupVariants(lower)) {
        const exactVariant = stmts.selectEntry.get(variant) as EntryRow | undefined;
        if (exactVariant) return buildEntry(exactVariant, stmts, lower);
        const inflVariant = stmts.selectInflectionLemma.get(variant) as
          | { lemma: string; type: string | null }
          | undefined;
        if (inflVariant) {
          const lemmaRow = stmts.selectEntry.get(inflVariant.lemma) as EntryRow | undefined;
          if (lemmaRow) {
            const label = inflectionLabel(inflVariant.type);
            return buildEntry(lemmaRow, stmts, lower, { stem: lemmaRow.word, label });
          }
        }
      }
    }

    // Steps 3–4 use Afrikaans-specific affix morphology — only run for `af`.
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
            return buildEntry(uRow, stmts, lower, {
              stem: undoubled,
              label: SUFFIX_LABELS[suffix],
            });
          }
        }
      }
    }

    // Step 5-morph: peel what the written form carries and the dictionary does
    // not key. Pack-driven. ko peels postpositions and endings; id peels
    // possessive clitics and voice prefixes.
    //
    // Korean attaches its grammar with no space. 도서관에서 is 도서관 plus the
    // locative, and 좋아하지 is the stem of 좋아하다 plus a connective. kaikki
    // enumerates the finite conjugation and neither of those, so steps 1 and 2
    // answer half a Korean text and this step answers most of the rest.
    //
    // It runs last on purpose. 보다 is the verb "to see" and also the
    // comparative particle, so an exact key has to win before anything is
    // peeled.
    if (isValidLanguageCode(language)) {
      const morphology = getLanguageConfig(language).morphology;
      if (morphology) {
        for (const candidate of stemCandidates(lower, morphology)) {
          const label = `${candidate.peeled.join(' + ')} form of`;
          const keyRow = stmts.selectEntry.get(candidate.key) as EntryRow | undefined;
          if (keyRow) {
            return buildEntry(keyRow, stmts, lower, { stem: keyRow.word, label });
          }
          const keyInfl = stmts.selectInflectionLemma.get(candidate.key) as
            | { lemma: string; type: string | null }
            | undefined;
          if (keyInfl) {
            const lemmaRow = stmts.selectEntry.get(keyInfl.lemma) as EntryRow | undefined;
            if (lemmaRow) {
              return buildEntry(lemmaRow, stmts, lower, { stem: lemmaRow.word, label });
            }
          }
        }
      }
    }

    // Step 5-ja: ask the analyser for the base form. Japanese cannot use the
    // peel above, because its endings are not a list a pack can hold. 読ん, 食べ
    // and 書か are three stem shapes of one conjugation, and the analyser is
    // what tells them apart.
    //
    // A Japanese lesson stores the analyser's surfaces as its word list (see
    // buildSegmentWords), so a reader taps 読ん and not 読んでいました. The
    // dictionary keys 読む and holds no 読ん, which left every verb in the
    // language with furigana above it and no definition behind it.
    //
    // ONE token only. Given a single reader token the analyser answers the stem
    // it came from, and 読ん gives 読む. Given a drag-selected phrase it answers
    // the first word instead, so 本を読ん would define 本. That is a confident
    // wrong answer where a miss is the honest one.
    if (language === 'ja') {
      const analysed = analyseJapanese(lower);
      if (analysed?.length === 1) {
        const lemma = analysed[0].lemma;
        if (lemma && lemma !== lower) {
          const lemmaRow = stmts.selectEntry.get(lemma) as EntryRow | undefined;
          if (lemmaRow) {
            return buildEntry(lemmaRow, stmts, lower, {
              stem: lemmaRow.word,
              label: 'base form of',
            });
          }
        }
      }
    }
  }

  // 5. AI cache fallthrough — user-accepted translations persisted in lector.db.
  const cached = lookupCached(userId, lower, language);
  if (cached) return cached;

  return undefined;
}
