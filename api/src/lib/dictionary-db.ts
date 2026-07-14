import { Database, type Statement } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import { db as userDb } from '../db';
import { DEFAULT_LANGUAGE, foldWord, getLanguageConfig, isValidLanguageCode } from './languages';
import { esperantoIpa } from '../../../languages/eo/ipa';
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
 * Mirrored from src/lib/server/dictionary-db.ts (better-sqlite3 → bun:sqlite);
 * keep the lookup algorithm and affix heuristics in sync.
 *
 * Built by `scripts/build-dictionary.ts` from the kaikki.org Wiktionary dump.
 * Lookup order: exact → inflections → prefix → suffix → affix-strip fallback,
 * then the AI cache (lector.db). The affix heuristics are Afrikaans-specific.
 */

// The dictionary is read-only application data shipped with the image. Prefer
// DICT_DIR so it stays put when the user mounts a volume on DATA_DIR for their
// (mutable) data; fall back to DATA_DIR, then '../data'. The default mirrors
// db.ts (which also defaults to '../data') because the API runs from ./api in
// local dev (`cd api && bun run …`) — a bare './data' resolved to the
// nonexistent ./api/data, so every dictionary lookup silently missed and every
// word fell through to the (slow) AI path.
function getDbPath(language: string): string {
  const dir = process.env.DICT_DIR || process.env.DATA_DIR || '../data';
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
};

const _stmtsByLang = new Map<string, Stmts>();

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
      selectInflectionLemma: db.prepare(
        'SELECT lemma, type FROM inflections WHERE inflected_form = ? LIMIT 1',
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

    // 2. Inflection table (e.g. "katte" → "kat")
    const infl = stmts.selectInflectionLemma.get(lower) as
      | { lemma: string; type: string | null }
      | undefined;
    if (infl) {
      const lemmaRow = stmts.selectEntry.get(infl.lemma) as EntryRow | undefined;
      if (lemmaRow) {
        const label = infl.type ? `${infl.type.replace(/,/g, ' ')} form of` : 'inflected form of';
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
  }

  // 5. AI cache fallthrough — user-accepted translations persisted in lector.db.
  const cached = lookupCached(userId, lower, language);
  if (cached) return cached;

  return undefined;
}
