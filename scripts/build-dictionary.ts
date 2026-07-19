/**
 * Build an on-device dictionary SQLite database from the kaikki.org Wiktionary
 * dump. Language-parameterized; defaults to Afrikaans. Run:
 *
 *     npx tsx scripts/build-dictionary.ts            # af (default)
 *     npx tsx scripts/build-dictionary.ts --lang de  # German
 *     npx tsx scripts/build-dictionary.ts --lang it  # Italian
 *
 * - Streams the JSONL dump line-by-line (does NOT load into memory).
 * - Caches the download in ./tmp/kaikki-<lang>.jsonl so reruns are fast.
 * - Merges hand-curated frequency ranks from the language's roots JSON (af only).
 * - Writes data/dictionary-<lang>.db (dropped + recreated each run).
 * - Verifies ≥85% coverage against a corpus drawn from data/lector.db (vocab.text)
 *   and data/books/*. Exits 1 if coverage is below the threshold.
 *
 * Per-language behavior lives in PROFILES below; `af` is byte-identical to the
 * original build. Strictly additive: it does not modify the legacy dictionary files.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { stripMarks } from '../languages/text';

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(PROJECT_ROOT, 'tmp');
const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, 'data');
const LECTOR_DB_PATH = path.join(DATA_DIR, 'lector.db');
const BOOKS_DIR = path.join(DATA_DIR, 'books');

const COVERAGE_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Per-language build profiles. Default `af` is byte-identical to the original
// Afrikaans build. Select another with `--lang <code>` (e.g. `--lang de`).
// ---------------------------------------------------------------------------

interface LangProfile {
  /** kaikki.org JSONL dump URLs, tried in order (HEAD-probed). */
  kaikkiUrls: string[];
  /** Inner char class (no brackets) for the coverage tokenizer/letter test. */
  letterClass: string;
  /** Affix-stripping rules for the coverage lookup. Empty arrays = no affix
   *  morphology (de resolves inflections via the kaikki `forms` table + UDPipe,
   *  not affix rules — see issue #203 §4a). */
  prefixes: string[];
  suffixes: string[];
  vowels: string;
  /** Hand-curated frequency ranks / fallback glosses, relative to PROJECT_ROOT,
   *  or null if the language has none (de ships rank=null v1). */
  rootsJsonRel: string | null;
  /** Newline-delimited word list for the coverage-gate corpus when the live
   *  corpus (lector.db + books) is thin. null = fall back to rootsJsonRel (af). */
  coverageCorpusRel: string | null;
  /** Drop entries with no English gloss — the de→en filter, and the large,
   *  natural size lever for the 1GB German dump. Off for af (parity-preserving). */
  glossFilter: boolean;
  /** Strip these combining marks from every dictionary key (ru: kaikki writes
   *  the lexical-stress acute on headwords and inflected forms — молоко́ — but
   *  runtime text is unstressed, so stressed keys would never be hit). */
  stripFromKeys?: RegExp;
  /** Also register the е-spelled variant of every ё key as an inflection alias
   *  (ru: ё is routinely written е in real text). Exact entries are looked up
   *  first, so genuine minimal pairs like все/всё keep their own entries. */
  yoAliases?: boolean;
  /** Register the mark-stripped variant of every key as an inflection alias
   *  (grc: running polytonic text disagrees with dictionary keys on marks —
   *  most commonly the grave replacing a word-final acute, τὸν vs τόν). The
   *  runtime's accent-insensitive fallback (dictionary-db.ts step 3-grc)
   *  retries lookups with the stripped key against these rows. Exact lookups
   *  always win first, so minimal pairs (ἡ/ἥ/ἤ) stay exact. */
  markStrippedAliases?: boolean;
  /** Extra (inflected_form, lemma, type) rows merged into the inflections
   *  table, TSV relative to PROJECT_ROOT (grc: MorphGNT surface→lemma pairs —
   *  kaikki Ancient Greek misses many Koine forms its Classical-leaning
   *  tables never enumerate). Rows whose lemma is not an entry are dropped. */
  supplementalInflectionsRel?: string | null;
}

const PROFILES: Record<string, LangProfile> = {
  af: {
    kaikkiUrls: [
      'https://kaikki.org/dictionary/Afrikaans/kaikki.org-dictionary-Afrikaans.jsonl',
      'https://kaikki.org/dictionary/downloads/af/kaikki.org-dictionary-Afrikaans.jsonl',
    ],
    letterClass: "a-zêëéèôöûüîïáàóíúýÿA-ZÊËÉÈÔÖÛÜÎÏÁÀÓÍÚÝŸ'-",
    prefixes: ['ont', 'ver', 'her', 'ge', 'be'],
    suffixes: ['heid', 'tjie', 'jie', 'ing', 'lik', 'te', 'de', 'e', 's'],
    vowels: 'aeiouyêëéèôöûüîïáà',
    rootsJsonRel: 'src/lib/dictionary-roots.json',
    coverageCorpusRel: null,
    glossFilter: false,
  },
  de: {
    // Canonical /German/ URL only — the /downloads/de/ fallback 404s (verified 2026-06-25).
    kaikkiUrls: ['https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl'],
    // af set + German ä/Ä and ß/ẞ.
    letterClass: "a-zäöüßêëéèôûîïáàóíúýÿA-ZÄÖÜẞÊËÉÈÔÛÎÏÁÀÓÍÚÝŸ'-",
    // No hand affix rules: German lookup = exact → inflections table → (UDPipe) → AI.
    prefixes: [],
    suffixes: [],
    vowels: 'aeiouyäöü',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-de.txt',
    glossFilter: true,
  },
  eo: {
    // Canonical /Esperanto/ URL (kaikki has no /downloads/eo/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Esperanto/kaikki.org-dictionary-Esperanto.jsonl'],
    // a-z + the six supersignoj ĉ ĝ ĥ ĵ ŝ ŭ — the complete 28-letter alphabet
    // (q w x y are not Esperanto letters). Apostrophe is a token boundary (the
    // poetic o-elision "mond'" is not a lemma form); hyphen stays a word char,
    // matching the runtime tokenizer.
    letterClass: 'a-zĉĝĥĵŝŭA-ZĈĜĤĴŜŬ-',
    // No hand affix rules at build time: kaikki Esperanto is form-of-rich
    // (plural/accusative/finite-verb forms carry their own entries), and the
    // runtime adds the deterministic rule analyzer for productive compounds
    // (api/src/lib/dictionary-db.ts eoLookupByRule, #307 §3.3) which the
    // build-time coverage gate doesn't need.
    prefixes: [],
    suffixes: [],
    vowels: 'aeiou',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-eo.txt',
    glossFilter: true,
  },
  es: {
    // Canonical /Spanish/ URL (kaikki has no /downloads/es/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Spanish/kaikki.org-dictionary-Spanish.jsonl'],
    // a-z + Spanish á/é/í/ó/ú/ü/ñ (the inverted marks ¿¡ are punctuation, not word chars).
    letterClass: "a-záéíóúüñA-ZÁÉÍÓÚÜÑ'-",
    // No hand affix rules: Spanish is highly inflected, but kaikki carries each
    // conjugated/plural surface form as its own "form of <lemma>" entry (which
    // keeps a gloss, so it survives glossFilter) — lookup resolves via those +
    // the inflections table, same strategy as de (exact → inflections → UDPipe → AI).
    prefixes: [],
    suffixes: [],
    vowels: 'aeiouáéíóúü',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-es.txt',
    glossFilter: true,
  },
  fr: {
    // Canonical /French/ URL (kaikki has no /downloads/fr/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl'],
    // a-z + French diacritics é è ê ë à â î ï ô û ù ü ÿ ç œ æ. Apostrophe is a
    // token boundary (NOT a word char): elision splits l'eau → l + eau, so the
    // content word `eau` is what the tokenizer sees — matching the runtime
    // WORD_PATTERN. Hyphen stays a word char for compounds (peut-être, arc-en-ciel).
    letterClass: 'a-zàâæçèéêëîïôûùüÿœA-ZÀÂÆÇÈÉÊËÎÏÔÛÙÜŸŒ-',
    // No hand affix rules: French is highly inflected, but kaikki carries each
    // conjugated/plural surface form as its own "form of <lemma>" entry (which
    // keeps a gloss, so it survives glossFilter) — lookup resolves via those +
    // the inflections table, same strategy as de/es (exact → inflections → UDPipe → AI).
    prefixes: [],
    suffixes: [],
    vowels: 'aeiouàâæèéêëîïôûùüÿœ',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-fr.txt',
    glossFilter: true,
  },
  it: {
    // Canonical /Italian/ URL (kaikki has no /downloads/it/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Italian/kaikki.org-dictionary-Italian.jsonl'],
    // Italian diacritics found in native text and loanwords. Apostrophe is a
    // token boundary (NOT a word char): l'acqua -> l + acqua and un'amica ->
    // un + amica, matching the runtime tokenizer. Hyphen remains a word char.
    letterClass: 'a-zàèéìíîòóùA-ZÀÈÉÌÍÎÒÓÙ-',
    // No hand affix rules: Italian form-of entries and the inflections table
    // resolve conjugated and plural surface forms, as for de/es/fr/nl.
    prefixes: [],
    suffixes: [],
    vowels: 'aeiouàèéìíîòóù',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-it.txt',
    glossFilter: true,
  },
  nl: {
    // Canonical /Dutch/ URL (kaikki has no /downloads/nl/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Dutch/kaikki.org-dictionary-Dutch.jsonl'],
    // a-z + Dutch trema (ë ï ö ü) and loanword accents (é è ê á à â ó ò ô ú ù û ç í î ì).
    // Apostrophe is a token boundary (NOT a word char): foto's → foto (+ dropped
    // 's'), 't/'n → dropped, matching the runtime WORD_PATTERN. Hyphen stays a
    // word char for compounds (zee-egel, na-apen). The ij digraph is plain i+j.
    letterClass: 'a-zàáâäçèéêëìíîïòóôöùúûüA-ZÀÁÂÄÇÈÉÊËÌÍÎÏÒÓÔÖÙÚÛÜ-',
    // No hand affix rules: like de/es/fr, Dutch inflections (plurals -en/-s,
    // diminutive -je/-tje, verb forms) resolve via kaikki "form of <lemma>"
    // entries + the inflections table (exact → inflections → UDPipe → AI). The
    // Afrikaans affix machinery is available if the coverage gate shows it's
    // needed, but Dutch is measured empty-first (kaikki Dutch is form-rich).
    prefixes: [],
    suffixes: [],
    vowels: 'aeiouyàáâäèéêëìíîïòóôöùúûü',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-nl.txt',
    glossFilter: true,
  },
  grc: {
    // Canonical /Ancient Greek/ URL — note the URL-encoded space and the
    // concatenated filename (verified 2026-07-19).
    kaikkiUrls: [
      'https://kaikki.org/dictionary/Ancient%20Greek/kaikki.org-dictionary-AncientGreek.jsonl',
    ],
    // Greek and Coptic (Ͱ-Ͽ) + Greek Extended (ἀ-῿): base letters, tonos
    // forms, and the polytonic precomposed range (breathings, graves,
    // circumflexes, iota subscripts). Hyphen kept for editorial compounds;
    // the elision apostrophe is a token boundary (κατ᾽ → κατ), matching the
    // runtime tokenizer. Only feeds the coverage tokenizer — corpus files are
    // one clean word per line.
    letterClass: 'Ͱ-Ͽἀ-῿-',
    // No hand affix rules: kaikki Ancient Greek is form-of-rich (declensions,
    // conjugations, dialect variants carry their own entries) and the runtime
    // adds the accent-insensitive fallback for running-text mark variance.
    prefixes: [],
    suffixes: [],
    vowels: 'αεηιουω',
    // NT lemma ranks (MorphGNT frequency — the curriculum for this audience)
    // + Dodson CC0 glosses for the Koine vocabulary kaikki lacks (καθώς,
    // πάντοτε…). Generated by gen-dictionary-roots-grc.py.
    rootsJsonRel: 'scripts/dictionary-roots-grc.json',
    coverageCorpusRel: 'scripts/coverage-corpus-grc.txt',
    glossFilter: true,
    // kaikki Ancient Greek writes vowel-length macrons/breves on headwords and
    // form rows (ᾰ̓γᾰ́πη) — editorial apparatus, never present in running text.
    // Breathings/accents/subscripts stay: they ARE the orthography.
    stripFromKeys: /[\u0304\u0306]/g,
    markStrippedAliases: true,
    supplementalInflectionsRel: 'scripts/morphgnt-inflections-grc.tsv',
  },
  pt: {
    // Canonical /Portuguese/ URL (kaikki has no /downloads/pt/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Portuguese/kaikki.org-dictionary-Portuguese.jsonl'],
    // a-z + Portuguese diacritics á à â ã ç é ê í ó ô õ ú (ü survives in some
    // pre-1990 spellings/proper names). Apostrophe stays a word char for the rare
    // d'água elision; hyphen for compounds (guarda-chuva, segunda-feira) and
    // enclitic pronouns (chamo-me), matching the runtime WORD_PATTERN. Brazilian
    // orthography is the default (pt-BR) — kaikki Portuguese covers both variants.
    letterClass: "a-zàáâãçéêíóôõúüA-ZÀÁÂÃÇÉÊÍÓÔÕÚÜ'-",
    // No hand affix rules: Portuguese is highly inflected, but kaikki carries each
    // conjugated/plural surface form as its own "form of <lemma>" entry (which
    // keeps a gloss, so it survives glossFilter) — lookup resolves via those +
    // the inflections table, same strategy as de/es/fr/nl (exact → inflections → UDPipe → AI).
    prefixes: [],
    suffixes: [],
    vowels: 'aeiouàáâãéêíóôõúü',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-pt.txt',
    glossFilter: true,
  },
  ru: {
    // Canonical /Russian/ URL (kaikki has no /downloads/ru/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Russian/kaikki.org-dictionary-Russian.jsonl'],
    // The 33-letter Cyrillic alphabet: а-я is contiguous except ё (U+0451),
    // which sits outside the range and is added explicitly. Hyphen stays a
    // word char for compounds (когда-нибудь, кто-то), matching the runtime
    // tokenizer. The apostrophe is not Russian orthography.
    letterClass: 'а-яёА-ЯЁ-',
    // No hand affix rules: Russian's rich inflection (6 cases × 3 genders,
    // verb conjugation + aspect pairs) resolves via kaikki "form of <lemma>"
    // entries + the inflections table, same strategy as de/es/fr/nl/pt.
    prefixes: [],
    suffixes: [],
    vowels: 'аеёиоуыэюя',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-ru.txt',
    glossFilter: true,
    // kaikki Russian marks lexical stress with a combining acute (and rare
    // grave for secondary stress) on headwords and form-of rows.
    stripFromKeys: /[\u0300\u0301]/g,
    yoAliases: true,
  },
};

function parseLangArg(): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang' && argv[i + 1]) return argv[i + 1];
    const m = a.match(/^--lang=(.+)$/);
    if (m) return m[1];
  }
  return 'af';
}

const LANG = parseLangArg();
const PROFILE = PROFILES[LANG];
if (!PROFILE) {
  console.error(`Unknown --lang "${LANG}". Known: ${Object.keys(PROFILES).join(', ')}`);
  process.exit(1);
}

const CACHE_PATH = path.join(TMP_DIR, `kaikki-${LANG}.jsonl`);
const DB_PATH = path.join(DATA_DIR, `dictionary-${LANG}.db`);
const ROOTS_JSON_PATH = PROFILE.rootsJsonRel ? path.join(PROJECT_ROOT, PROFILE.rootsJsonRel) : null;
const COVERAGE_CORPUS_PATH = PROFILE.coverageCorpusRel
  ? path.join(PROJECT_ROOT, PROFILE.coverageCorpusRel)
  : null;
const KAIKKI_URLS = PROFILE.kaikkiUrls;

// Affix-stripping constants — MUST mirror src/lib/dictionary.ts so the coverage
// check reflects what the live lookup will see. Empty for languages (de) that
// resolve inflections via the kaikki `forms` table instead of affix rules.
const PREFIXES = PROFILE.prefixes;
const SUFFIXES = PROFILE.suffixes;
const VOWELS = new Set(PROFILE.vowels.split(''));
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
// Step 1 — Download dump (cached)
// ---------------------------------------------------------------------------

async function ensureDump(): Promise<string> {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  if (fs.existsSync(CACHE_PATH) && fs.statSync(CACHE_PATH).size > 1_000_000) {
    console.log(`[1/5] Using cached dump at ${CACHE_PATH}`);
    return CACHE_PATH;
  }

  let lastErr: unknown = undefined;
  for (const url of KAIKKI_URLS) {
    try {
      console.log(`[1/5] HEAD ${url}`);
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok) {
        console.log(`  not ok (${head.status}) — trying next`);
        continue;
      }

      console.log(`[1/5] Downloading ${url} ...`);
      const res = await fetch(url);
      if (!res.ok || !res.body) {
        throw new Error(`Download failed: HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(CACHE_PATH, buf);
      console.log(`  wrote ${(buf.length / 1024 / 1024).toFixed(2)} MB to ${CACHE_PATH}`);
      return CACHE_PATH;
    } catch (err) {
      lastErr = err;
      console.log(`  failed: ${(err as Error).message}`);
    }
  }

  console.error(`\n[!] Could not download the kaikki ${LANG} dump.`);
  console.error('    Tried:');
  for (const u of KAIKKI_URLS) console.error('      -', u);
  console.error(`    Manual fix: download one of those URLs and save it as`);
  console.error(`      ${CACHE_PATH}`);
  console.error(`    then re-run this script.`);
  if (lastErr) console.error('    Last error:', (lastErr as Error).message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 2 — Parse JSONL & extract structured data
// ---------------------------------------------------------------------------

interface ExtractedEntry {
  word: string;
  pos?: string;
  ipa?: string;
  etymology?: string;
  senses: Array<{ pos: string; gloss: string }>;
  relatedForms: Array<{ form: string; relation: string }>;
  inflections: Array<{ inflected: string; type: string }>;
}

interface KaikkiSound {
  ipa?: string;
}
interface KaikkiSense {
  glosses?: string[];
}
interface KaikkiForm {
  form?: string;
  tags?: string[];
}
interface KaikkiRel {
  word?: string;
}
interface KaikkiLine {
  word?: string;
  pos?: string;
  etymology_text?: string;
  sounds?: KaikkiSound[];
  senses?: KaikkiSense[];
  forms?: KaikkiForm[];
  derived?: KaikkiRel[];
  related?: KaikkiRel[];
}

function pickIpa(sounds: KaikkiSound[] | undefined): string | undefined {
  if (!sounds) return undefined;
  for (const s of sounds) {
    if (s.ipa) return s.ipa;
  }
  return undefined;
}

// Dictionary keys are NFC + lowercase (#289): must match the runtime foldWord
// (languages/text.ts) or decomposed dump data would never be hit by lookups.
// Profiles may additionally strip combining marks the dump carries but runtime
// text doesn't (ru lexical stress, grc vowel-length macrons/breves). The strip
// runs on the NFD form so precomposed carriers are caught too (Greek Extended
// has precomposed alpha-with-macron, ᾱ = U+1FB1); the final NFC recomposes
// legitimate mark-bearing letters (ё, й, breathings/accents) untouched — their
// marks aren't in any profile's strip set.
function foldKey(s: string): string {
  const folded = s.normalize('NFC').toLowerCase().trim();
  if (!PROFILE.stripFromKeys) return folded;
  return folded.normalize('NFD').replace(PROFILE.stripFromKeys, '').normalize('NFC');
}

function extractEntry(raw: KaikkiLine): ExtractedEntry | null {
  if (!raw.word) return null;
  const word = foldKey(raw.word);
  if (!word) return null;

  const senses: Array<{ pos: string; gloss: string }> = [];
  for (const s of raw.senses || []) {
    for (const gloss of s.glosses || []) {
      const g = gloss.trim();
      if (g) senses.push({ pos: raw.pos || '', gloss: g });
    }
  }

  const inflections: Array<{ inflected: string; type: string }> = [];
  for (const f of raw.forms || []) {
    if (!f.form) continue;
    // Non-Latin-script dumps (ru) carry a Latin transliteration per form —
    // never a lookup key, and a table-sized bloat if kept. table-tags /
    // inflection-template / class are kaikki's documented pseudo-forms (table
    // metadata, e.g. form "no-table-tags" or a Zaliznyak class marker), ~18%
    // of the raw Russian forms table.
    const SKIP_FORM_TAGS = [
      'romanization',
      'transliteration',
      'table-tags',
      'inflection-template',
      'class',
    ];
    if (f.tags?.some((t) => SKIP_FORM_TAGS.includes(t))) continue;
    const inflected = foldKey(f.form);
    if (!inflected || inflected === word) continue;
    // Skip non-Afrikaans-form rows (table headers, no-form rows)
    if (inflected.includes(' ') || inflected.length < 2) continue;
    const type = (f.tags || []).join(',') || 'form';
    inflections.push({ inflected, type });
  }

  const relatedForms: Array<{ form: string; relation: string }> = [];
  for (const r of raw.derived || []) {
    if (r.word) relatedForms.push({ form: foldKey(r.word), relation: 'derived' });
  }
  for (const r of raw.related || []) {
    if (r.word) relatedForms.push({ form: foldKey(r.word), relation: 'related' });
  }

  return {
    word,
    pos: raw.pos,
    ipa: pickIpa(raw.sounds),
    etymology: raw.etymology_text,
    senses,
    relatedForms,
    inflections,
  };
}

interface MergedEntry {
  word: string;
  rank?: number;
  ipa?: string;
  etymology?: string;
  senses: Array<{ pos: string; gloss: string }>;
  relatedForms: Array<{ form: string; relation: string }>;
}

async function parseDump(dumpPath: string): Promise<{
  entries: Map<string, MergedEntry>;
  inflectionMap: Map<string, Set<string>>; // inflected -> set of "lemma::type"
}> {
  console.log(`[2/5] Streaming ${dumpPath} ...`);
  const stream = fs.createReadStream(dumpPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const entries = new Map<string, MergedEntry>();
  const inflectionMap = new Map<string, Set<string>>(); // inflected -> "lemma::type"

  let lineNo = 0;
  let skipped = 0;
  for await (const line of rl) {
    lineNo++;
    if (!line.trim()) continue;
    let raw: KaikkiLine;
    try {
      raw = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const ex = extractEntry(raw);
    if (!ex) continue;

    // Merge multiple kaikki entries for the same word (different POS, etc.)
    let merged = entries.get(ex.word);
    if (!merged) {
      merged = {
        word: ex.word,
        ipa: ex.ipa,
        etymology: ex.etymology,
        senses: [],
        relatedForms: [],
      };
      entries.set(ex.word, merged);
    } else {
      if (!merged.ipa && ex.ipa) merged.ipa = ex.ipa;
      if (!merged.etymology && ex.etymology) merged.etymology = ex.etymology;
    }
    merged.senses.push(...ex.senses);
    merged.relatedForms.push(...ex.relatedForms);

    for (const inf of ex.inflections) {
      let bucket = inflectionMap.get(inf.inflected);
      if (!bucket) {
        bucket = new Set<string>();
        inflectionMap.set(inf.inflected, bucket);
      }
      bucket.add(`${ex.word}::${inf.type}`);
    }
  }

  console.log(
    `  parsed ${lineNo} lines, extracted ${entries.size} unique words (skipped ${skipped} malformed)`,
  );
  return { entries, inflectionMap };
}

// ---------------------------------------------------------------------------
// Step 3 — Merge hand-curated ranks from dictionary-roots.json
// ---------------------------------------------------------------------------

interface RootJsonEntry {
  rank: number;
  translation: string;
  partOfSpeech: string;
}

function mergeRanks(entries: Map<string, MergedEntry>): { added: number; ranked: number } {
  if (!ROOTS_JSON_PATH) {
    console.log('[3/5] No curated roots for this language — skipping rank merge');
    return { added: 0, ranked: 0 };
  }
  const rootJson = JSON.parse(fs.readFileSync(ROOTS_JSON_PATH, 'utf-8')) as Record<
    string,
    RootJsonEntry
  >;
  let ranked = 0;
  let added = 0;
  for (const [word, root] of Object.entries(rootJson)) {
    const lower = word.toLowerCase();
    let existing = entries.get(lower);
    if (!existing) {
      // Add words that exist in the curated dict but are missing from kaikki
      existing = {
        word: lower,
        senses: [],
        relatedForms: [],
      };
      entries.set(lower, existing);
      added++;
    }
    existing.rank = root.rank;
    // If kaikki has no senses for this word, fall back to the curated translation
    if (existing.senses.length === 0 && root.translation) {
      existing.senses.push({
        pos: root.partOfSpeech || '',
        gloss: root.translation,
      });
    }
    ranked++;
  }
  console.log(
    `[3/5] Merged ranks: ${ranked} words tagged, ${added} added that were missing from kaikki`,
  );
  return { added, ranked };
}

// ---------------------------------------------------------------------------
// Step 4 — Build SQLite
// ---------------------------------------------------------------------------

function buildDatabase(
  entries: Map<string, MergedEntry>,
  inflectionMap: Map<string, Set<string>>,
): { totalEntries: number; totalSenses: number; totalInflections: number; sizeMb: number } {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Remove any prior DB so the build is idempotent
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      fs.unlinkSync(DB_PATH + suffix);
    } catch {
      /* ignore */
    }
  }

  console.log(`[4/5] Writing SQLite to ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    DROP TABLE IF EXISTS entries;
    DROP TABLE IF EXISTS senses;
    DROP TABLE IF EXISTS related_forms;
    DROP TABLE IF EXISTS inflections;

    CREATE TABLE entries (
      word TEXT PRIMARY KEY,
      rank INTEGER,
      ipa TEXT,
      etymology TEXT
    );

    CREATE TABLE senses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      pos TEXT,
      gloss TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );
    CREATE INDEX idx_senses_word ON senses(word);

    CREATE TABLE related_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      related_word TEXT NOT NULL,
      relation TEXT NOT NULL
    );
    CREATE INDEX idx_related_word ON related_forms(word);

    CREATE TABLE inflections (
      inflected_form TEXT NOT NULL,
      lemma TEXT NOT NULL,
      type TEXT,
      PRIMARY KEY (inflected_form, lemma)
    );
    CREATE INDEX idx_inflections_lemma ON inflections(lemma);
  `);

  const insertEntry = db.prepare(
    'INSERT INTO entries (word, rank, ipa, etymology) VALUES (?, ?, ?, ?)',
  );
  const insertSense = db.prepare(
    'INSERT INTO senses (word, pos, gloss, sort_order) VALUES (?, ?, ?, ?)',
  );
  const insertRelated = db.prepare(
    'INSERT INTO related_forms (word, related_word, relation) VALUES (?, ?, ?)',
  );
  const insertInflection = db.prepare(
    'INSERT OR IGNORE INTO inflections (inflected_form, lemma, type) VALUES (?, ?, ?)',
  );

  let totalEntries = 0;
  let totalSenses = 0;
  let totalInflections = 0;

  const tx = db.transaction(() => {
    for (const [, entry] of entries) {
      insertEntry.run(entry.word, entry.rank ?? null, entry.ipa ?? null, entry.etymology ?? null);
      totalEntries++;

      // Deduplicate senses (same gloss + pos)
      const seenSense = new Set<string>();
      let order = 0;
      for (const s of entry.senses) {
        const key = `${s.pos}|${s.gloss}`;
        if (seenSense.has(key)) continue;
        seenSense.add(key);
        insertSense.run(entry.word, s.pos || null, s.gloss, order++);
        totalSenses++;
      }

      const seenRelated = new Set<string>();
      for (const r of entry.relatedForms) {
        const key = `${r.form}|${r.relation}`;
        if (seenRelated.has(key) || !r.form) continue;
        seenRelated.add(key);
        insertRelated.run(entry.word, r.form, r.relation);
      }
    }

    for (const [inflected, bucket] of inflectionMap) {
      for (const ref of bucket) {
        const sep = ref.indexOf('::');
        const lemma = ref.slice(0, sep);
        const type = ref.slice(sep + 2);
        // Only insert when the lemma is actually in entries (skip orphans)
        if (!entries.has(lemma)) continue;
        const r = insertInflection.run(inflected, lemma, type || null);
        if (r.changes) totalInflections++;
      }
    }
  });
  tx();

  // Vacuum + close so size reflects final state
  db.exec('VACUUM');
  db.close();

  const stat = fs.statSync(DB_PATH);
  const sizeMb = stat.size / 1024 / 1024;

  return { totalEntries, totalSenses, totalInflections, sizeMb };
}

// ---------------------------------------------------------------------------
// Step 5 — Coverage check
// ---------------------------------------------------------------------------

interface LookupShape {
  word: string;
}

// Esperanto rule morphology for the coverage lookup — mirrors the runtime
// analyzer (api/src/lib/dictionary-db.ts eoLookupByRule, #307 §3.3) so the
// gate reflects what the live lookup will actually resolve: grammatical
// endings (-j/-n), finite verbs (→ -i), derived adverbs (→ -a/-o), and
// derivational affix peeling for productive compounds (futbalisto,
// hungarlingve). Keep the affix lists in sync with the runtime.
const EO_PREFIXES = ['mal', 'eks', 'mis', 'dis', 'pra', 'ĉef', 'ek', 'ge', 're', 'bo', 'fi'];
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
const EO_MIN_ROOT = 3;

function eoRuleLookup(exact: Database.Statement, lower: string): { word: string } | undefined {
  const tryExact = (w: string) => exact.get(w) as { word: string } | undefined;
  const resolveRoot = (root: string) => {
    for (const v of ['o', 'i', 'a', 'e']) {
      const row = tryExact(root + v);
      if (row) return row;
    }
    return undefined;
  };

  // grammatical endings: domojn → domo, belaj → bela
  for (const ending of ['jn', 'j', 'n']) {
    if (lower.endsWith(ending) && lower.length - ending.length >= 2) {
      const row = tryExact(lower.slice(0, -ending.length));
      if (row) return row;
    }
  }
  // finite verb → infinitive: rezultigas → rezultigi
  const verb = lower.match(/(?:as|is|os|us|u)$/u);
  if (verb && lower.length - verb[0].length >= 2) {
    const row = tryExact(lower.slice(0, -verb[0].length) + 'i');
    if (row) return row;
  }
  // derived adverb → adjective/noun: hejme → hejmo
  if (lower.endsWith('e') && lower.length >= 3) {
    for (const v of ['a', 'o']) {
      const row = tryExact(lower.slice(0, -1) + v);
      if (row) return row;
    }
  }
  // affix peeling to a dictionary root: futbalisto → futbalo. Depth-first
  // with backtracking, like the runtime analyzer — greedy peeling dead-ends
  // on stems like malsan- (suffix -an vs prefix mal-).
  const peel = (root: string, depth: number): { word: string } | undefined => {
    if (root.length < EO_MIN_ROOT) return undefined;
    const row = resolveRoot(root);
    if (row && row.word !== lower) return row;
    if (depth >= 5) return undefined;
    const suffix = EO_SUFFIXES.find(
      (s) => root.endsWith(s) && root.length - s.length >= EO_MIN_ROOT,
    );
    if (suffix) {
      const hit = peel(root.slice(0, -suffix.length), depth + 1);
      if (hit) return hit;
    }
    const prefix = EO_PREFIXES.find(
      (p) => root.startsWith(p) && root.length - p.length >= EO_MIN_ROOT,
    );
    if (prefix) {
      const hit = peel(root.slice(prefix.length), depth + 1);
      if (hit) return hit;
    }
    return undefined;
  };
  let stem = lower.replace(/n$/u, '').replace(/j$/u, '');
  if (/(?:as|is|os|us)$/u.test(stem) && stem === lower) stem = stem.slice(0, -2);
  else if (/[oaieu]$/u.test(stem)) stem = stem.slice(0, -1);
  else return undefined;
  const peeledHit = peel(stem, 0);
  if (peeledHit) return peeledHit;
  // root compound → its head: hungarlingve → lingvo
  const compoundSource = lower.replace(/(?:jn|j|n)$/u, '');
  for (let i = 1; i <= compoundSource.length - 4; i++) {
    const row = tryExact(compoundSource.slice(i));
    if (row) return row;
  }
  return undefined;
}

function buildLookup(db: Database.Database): (w: string) => LookupShape | undefined {
  const exact = db.prepare('SELECT word FROM entries WHERE word = ?');
  // Rank-ordered like the runtime (dictionary-db.ts selectInflectionLemma):
  // when several lemmas claim a surface form, the most frequent entry wins.
  const byInflection = db.prepare(
    `SELECT i.lemma FROM inflections i
     JOIN entries e ON e.word = i.lemma
     WHERE i.inflected_form = ?
     ORDER BY (e.rank IS NULL), e.rank, i.rowid LIMIT 1`,
  );

  return function lookup(w: string): LookupShape | undefined {
    const lower = w.toLowerCase();

    const hit = exact.get(lower) as { word: string } | undefined;
    if (hit) return hit;

    const infl = byInflection.get(lower) as { lemma: string } | undefined;
    if (infl) {
      const lemma = exact.get(infl.lemma) as { word: string } | undefined;
      if (lemma) return lemma;
    }

    if (LANG === 'eo') {
      const ruled = eoRuleLookup(exact, lower);
      if (ruled) return ruled;
    }

    // Mirror of the runtime accent-insensitive fallback (dictionary-db.ts
    // step 3-grc): retry with the mark-stripped key against the alias rows,
    // so the gate measures what the live lookup will actually resolve.
    if (PROFILE.markStrippedAliases) {
      const stripped = stripMarks(lower);
      if (stripped !== lower) {
        const strippedHit = exact.get(stripped) as { word: string } | undefined;
        if (strippedHit) return strippedHit;
        const strippedInfl = byInflection.get(stripped) as { lemma: string } | undefined;
        if (strippedInfl) {
          const lemma = exact.get(strippedInfl.lemma) as { word: string } | undefined;
          if (lemma) return lemma;
        }
      }
    }

    for (const prefix of PREFIXES) {
      if (!lower.startsWith(prefix)) continue;
      const stem = lower.slice(prefix.length);
      if (stem.length < MIN_STEM) continue;
      const stemHit = exact.get(stem) as { word: string } | undefined;
      if (stemHit) return stemHit;
    }

    for (const suffix of SUFFIXES) {
      if (!lower.endsWith(suffix)) continue;
      const stem = lower.slice(0, -suffix.length);
      if (stem.length < MIN_STEM) continue;
      const stemHit = exact.get(stem) as { word: string } | undefined;
      if (stemHit) return stemHit;
      const undoubled = undoubleConsonant(stem);
      if (undoubled && undoubled.length >= MIN_STEM) {
        const u = exact.get(undoubled) as { word: string } | undefined;
        if (u) return u;
      }
    }

    return undefined;
  };
}

const LETTER_RE = new RegExp(`^[${PROFILE.letterClass}]+$`);
const SPLIT_RE = new RegExp(`[^${PROFILE.letterClass}]+`);

function tokenize(text: string): string[] {
  return text
    .split(SPLIT_RE)
    .filter(Boolean)
    .filter((w) => LETTER_RE.test(w) && w.length >= 2);
}

function gatherCorpus(): Set<string> {
  const corpus = new Set<string>();

  // From data/lector.db vocab.text — the BUILD language's rows only. The vocab
  // table holds every language the user studies; without the filter, building
  // (say) the eo dictionary in a lived-in checkout poisons the coverage gate
  // with Afrikaans vocab and fails on words the eo dictionary rightly misses.
  // (Earlier non-af builds dodged this only by running in fresh clones.)
  if (fs.existsSync(LECTOR_DB_PATH)) {
    try {
      const lectorDb = new Database(LECTOR_DB_PATH, { readonly: true });
      try {
        const rows = lectorDb
          .prepare('SELECT DISTINCT lower(text) AS t FROM vocab WHERE language = ?')
          .all(LANG) as {
          t: string;
        }[];
        for (const row of rows) {
          if (row.t) {
            for (const tok of tokenize(row.t)) corpus.add(tok.toLowerCase());
          }
        }
      } catch (err) {
        console.log(`  (couldn't read vocab from lector.db: ${(err as Error).message})`);
      } finally {
        lectorDb.close();
      }
    } catch (err) {
      console.log(`  (couldn't open lector.db: ${(err as Error).message})`);
    }
  }

  // From data/books/* — af only: book files carry no language tag (a legacy
  // af-era corpus source), so other languages must not inherit them.
  if (LANG === 'af' && fs.existsSync(BOOKS_DIR)) {
    const files = fs.readdirSync(BOOKS_DIR, { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile()) continue;
      const full = path.join(BOOKS_DIR, f.name);
      try {
        const text = fs.readFileSync(full, 'utf-8');
        for (const tok of tokenize(text)) corpus.add(tok.toLowerCase());
      } catch {
        /* skip binary files */
      }
    }
  }

  return corpus;
}

function coverageCheck(): { hits: number; total: number; misses: string[] } {
  console.log(`[5/5] Running coverage check ...`);

  const corpus = gatherCorpus();
  console.log(`  corpus size: ${corpus.size} unique tokens`);

  // On a fresh checkout the live corpus (vocab + books) is often tiny or
  // empty. An explicit coverage-corpus file is the best stand-in — real
  // SURFACE forms of typical reading (frequency lists, or the GNT running
  // text for grc), which exercises the inflection/fallback machinery the way
  // live lookups do. Checked before the roots fallback: for a language with
  // both (grc), lemma-keyed roots would trivially hit their own merged
  // entries and mask form-resolution gaps.
  if (corpus.size < 100 && COVERAGE_CORPUS_PATH) {
    const before = corpus.size;
    for (const line of fs.readFileSync(COVERAGE_CORPUS_PATH, 'utf-8').split('\n')) {
      const w = line.trim();
      if (!w || w.startsWith('#')) continue;
      corpus.add(w.toLowerCase());
    }
    console.log(
      `  (corpus was thin, added ${corpus.size - before} corpus-file tokens → ${corpus.size} tokens)`,
    );
  }

  // The curated frequency-ranked roots are the last-resort proxy (af ships
  // roots but no corpus file).
  if (corpus.size < 100 && ROOTS_JSON_PATH) {
    const rootJson = JSON.parse(fs.readFileSync(ROOTS_JSON_PATH, 'utf-8')) as Record<
      string,
      RootJsonEntry
    >;
    const before = corpus.size;
    for (const w of Object.keys(rootJson)) corpus.add(w.toLowerCase());
    console.log(
      `  (corpus was thin, added ${corpus.size - before} curated roots → ${corpus.size} tokens)`,
    );
  }

  const db = new Database(DB_PATH, { readonly: true });
  const lookup = buildLookup(db);

  let hits = 0;
  const misses: string[] = [];
  for (const w of corpus) {
    if (lookup(w)) hits++;
    else if (misses.length < 50) misses.push(w);
  }
  db.close();

  return { hits, total: corpus.size, misses };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  console.log(`Building ${LANG} dictionary → ${DB_PATH}`);
  const dumpPath = await ensureDump();
  const { entries, inflectionMap } = await parseDump(dumpPath);
  mergeRanks(entries);

  if (PROFILE.yoAliases) {
    // Register the е-spelled variant of every ё key as an extra inflection row
    // pointing at the same lemma. Runs before the gloss filter builds nothing
    // extra: buildDatabase drops alias rows whose lemma was filtered out.
    const addAlias = (alias: string, ref: string) => {
      let bucket = inflectionMap.get(alias);
      if (!bucket) {
        bucket = new Set<string>();
        inflectionMap.set(alias, bucket);
      }
      bucket.add(ref);
    };
    let aliased = 0;
    for (const word of entries.keys()) {
      if (!word.includes('ё')) continue;
      addAlias(word.replaceAll('ё', 'е'), `${word}::ё-spelling`);
      aliased++;
    }
    for (const [inflected, bucket] of [...inflectionMap]) {
      if (!inflected.includes('ё')) continue;
      const alias = inflected.replaceAll('ё', 'е');
      for (const ref of bucket) addAlias(alias, ref);
      aliased++;
    }
    console.log(`  ё-aliases (${LANG}): ${aliased} е-spelled variants registered`);
  }

  if (PROFILE.supplementalInflectionsRel) {
    // Merge corpus-verified (form → lemma) pairs the dump never enumerated
    // (grc: MorphGNT). Runs BEFORE the mark-stripped alias pass so these
    // forms get stripped aliases too; rows with lemmas missing from entries
    // are dropped by buildDatabase like any other orphan.
    const tsvPath = path.join(PROJECT_ROOT, PROFILE.supplementalInflectionsRel);
    let merged = 0;
    for (const line of fs.readFileSync(tsvPath, 'utf-8').split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const [inflected, lemma, type] = line.split('\t');
      if (!inflected || !lemma) continue;
      let bucket = inflectionMap.get(inflected);
      if (!bucket) {
        bucket = new Set<string>();
        inflectionMap.set(inflected, bucket);
      }
      bucket.add(`${lemma}::${type || 'supplemental'}`);
      merged++;
    }
    console.log(
      `  supplemental inflections (${LANG}): ${merged} rows merged from ${PROFILE.supplementalInflectionsRel}`,
    );
  }

  if (PROFILE.markStrippedAliases) {
    // Register the mark-stripped variant of every key as an extra inflection
    // row (type 'unaccented') so the runtime's accent-insensitive fallback
    // has something to hit. Entry words alias to themselves as lemma;
    // inflection keys copy their lemma refs. Collisions are fine: exact
    // lookups win first, and INSERT OR IGNORE dedupes per (form, lemma).
    const addAlias = (alias: string, ref: string) => {
      let bucket = inflectionMap.get(alias);
      if (!bucket) {
        bucket = new Set<string>();
        inflectionMap.set(alias, bucket);
      }
      bucket.add(ref);
    };
    let aliased = 0;
    for (const word of entries.keys()) {
      const stripped = stripMarks(word);
      if (stripped === word || !stripped) continue;
      addAlias(stripped, `${word}::unaccented`);
      aliased++;
    }
    for (const [inflected, bucket] of [...inflectionMap]) {
      const stripped = stripMarks(inflected);
      if (stripped === inflected || !stripped) continue;
      for (const ref of bucket) addAlias(stripped, ref);
      aliased++;
    }
    console.log(`  mark-stripped aliases (${LANG}): ${aliased} keys registered`);
  }

  if (PROFILE.glossFilter) {
    let dropped = 0;
    for (const [w, e] of entries) {
      if (e.senses.length === 0) {
        entries.delete(w);
        dropped++;
      }
    }
    console.log(
      `  gloss-filter (${LANG}): dropped ${dropped} glossless entries → ${entries.size} kept`,
    );
  }

  const summary = buildDatabase(entries, inflectionMap);
  const { hits, total, misses } = coverageCheck();

  console.log('\n=== Build summary ===');
  console.log(`  entries:     ${summary.totalEntries}`);
  console.log(`  senses:      ${summary.totalSenses}`);
  console.log(`  inflections: ${summary.totalInflections}`);
  console.log(`  file size:   ${summary.sizeMb.toFixed(2)} MB`);
  console.log(`  build time:  ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (total === 0) {
    console.log('\nNo corpus tokens to score against — skipping coverage gate.');
    return;
  }

  const pct = hits / total;
  console.log(`\nCoverage: ${hits}/${total} words = ${(pct * 100).toFixed(1)}%`);

  if (pct < COVERAGE_THRESHOLD) {
    console.error(
      `\nCoverage below ${(COVERAGE_THRESHOLD * 100).toFixed(0)}% threshold. First 50 misses:`,
    );
    for (const m of misses) console.error('  -', m);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
