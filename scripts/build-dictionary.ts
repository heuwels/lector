/**
 * Build an on-device dictionary SQLite database from the kaikki.org Wiktionary
 * dump. Language-parameterized; defaults to Afrikaans. Run:
 *
 *     npx tsx scripts/build-dictionary.ts            # af (default)
 *     npx tsx scripts/build-dictionary.ts --lang de  # German
 *     npx tsx scripts/build-dictionary.ts --lang it  # Italian
 *
 * - Streams the download to disk, then the JSONL dump line-by-line.
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
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { stemCandidates } from '../languages/morphology';
import { LANGUAGES, isValidLanguageCode } from '../languages/registry';
import { arabicLooseKey, foldArabicKey, stripMarks } from '../languages/text';

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
  /** Minimum coverage this language must reach, overriding COVERAGE_THRESHOLD.
   *
   *  Set this ONLY where the source data, and not the build, is the limit, and
   *  only with a measurement in the profile comment saying what the limit is.
   *  It is a regression gate, not a target: pin it just below what the language
   *  measures today, so a worse dump or a broken fold still fails the build.
   *
   *  bn and gd set it. Every other pack clears 85% against a 5,000-word
   *  wordfreq corpus. bn reaches 69.7% because English Wiktionary holds
   *  9,929 glossed Bengali headwords. gd reaches 78.2% because the Gaelic
   *  dump holds 16,909 entries and Wikipedia still writes place-name
   *  fragments and plurals the dump does not list. No lever in this file
   *  closes a vocabulary gap.
   *
   *  A miss is not a dead end for the reader. api/src/routes/dictionary.ts
   *  returns `{ entry: null }` and the caller falls back to AI translate, and
   *  an accepted translation is cached back through POST /api/dictionary/cache.
   *  So a lower gate buys more LLM calls, not failed lookups — which is the
   *  trade this lever exists to make explicit rather than silent. */
  coverageThreshold?: number;
  /** Drop entries with no English gloss — the de→en filter, and the large,
   *  natural size lever for the 1GB German dump. Off for af (parity-preserving). */
  glossFilter: boolean;
  /** Case-fold locale, mirroring the pack's `script.caseFoldLocale` (tr only).
   *  Keys the DB the same way the runtime folds lookups, so the dotted/dotless
   *  i can't split one word across two keys. */
  caseFoldLocale?: string;
  /** Fold every apostrophe variant to ASCII ' in keys, mirroring the pack's
   *  `script.foldApostrophes` (uk, it). kaikki writes those headwords with
   *  ASCII ', so this is a no-op for the dump itself — it exists so the
   *  build and the runtime cannot disagree if a variant appears in a form-of
   *  row. */
  foldApostrophes?: boolean;
  /** Strip these combining marks from every dictionary key (ru: kaikki writes
   *  the lexical-stress acute on headwords and inflected forms — молоко́ — but
   *  runtime text is unstressed, so stressed keys would never be hit). */
  stripFromKeys?: RegExp;
  /** Unfold æ/œ to ae/oe in keys (la: editions mix ligatures and digraphs). */
  unfoldLigatures?: boolean;
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

  // --- Unspaced-CJK levers (#213). Every one of these is measured against the
  // --- kaikki Chinese dump; see the comments on the `zh` profile.

  /** Shortest form allowed into the inflections table. Defaults to 2, which
   *  drops kaikki's table-header junk. zh must set 1: 1,603 of its Simplified
   *  forms are a single character, and a single Han character is a real word. */
  minInflectionLength?: number;
  /** Skip a form whose `raw_tags` contain any of these (zh: 'nonstandard simp.'
   *  marks a junk variant that must never become a key). */
  skipFormRawTags?: string[];
  /** Skip a form matching this pattern (zh: Ideographic Description Characters
   *  U+2FF0–U+2FFB, which kaikki uses to *describe* a glyph it cannot encode —
   *  ⿵門𠯮 is a picture of a character, not a word). */
  skipFormPattern?: RegExp;
  /** Extra `tags` values that disqualify a form, on top of the shared list
   *  (zh: 'Second-Round-Simplified-Chinese', a defunct 1977 scheme, 821 rows). */
  extraSkipFormTags?: string[];
  /** Re-key every entry onto its Simplified form, using the generated map at
   *  this path, and register the headword as an alias (zh only). Text in either
   *  script then resolves, and the entry itself is keyed on what a learner of
   *  Mandarin reads.
   *
   *  The map is generated from OpenCC by `scripts/gen-zh-t2s-map.py`, NOT read
   *  off kaikki's `forms` table. kaikki's Simplified rows cannot be trusted for
   *  a key:
   *
   *    - A row tagged ['alternative', 'Simplified-Chinese'] is the Simplified
   *      spelling of an ALTERNATIVE character, not of the headword. 今 lists
   *      當/当 as an alternative form, so 今 claimed the key 当 and shipped
   *      `jīn` for it. 8,358 keys were claimed this way, 儿 气 业 吗 满 码 调
   *      农 among them.
   *    - The honest row is often missing. 這, 當, 卻 and 參 carry none at all,
   *      which is why their keys were left to the first alternative row.
   *    - Even the rows with no `alternative` tag are unreliable. OpenCC agrees
   *      with 102,552 of them and disagrees with 1,371, and the disagreements
   *      are kaikki being wrong: it answers 鲁 for 嚕 (that is 魯) and 辟 for
   *      僻.
   *
   *  So OpenCC decides, and the dump is not consulted for the key at all. */
  t2sMapRel?: string;
  /** Dominant single-character readings, from the generated map at this path
   *  (zh only). A character with one of these takes it, in place of anything the
   *  dump offers.
   *
   *  A Han character carries several readings and kaikki cannot rank them. It
   *  also splits them across records: the 的 page has one record whose Standard
   *  Pinyin is `dì` and another for the particle `de`. The merge keeps the first
   *  reading it meets, so 的 shipped as `dì` — a wrong reading above the most
   *  frequent character in the language.
   *
   *  Generated by scripts/gen-zh-readings.py from pypinyin, which ranks readings
   *  by frequency. Single characters only: every error an audit of the top 2,000
   *  words found was a single character, a compound needs no ranking, and
   *  pypinyin would re-segment a compound worse than kaikki spells it. */
  readingMapRel?: string;
  /** Prefer a `sounds[]` romanisation over `ipa` for the entry's pronunciation
   *  string. An ORDERED list of tag-sets: the first set with a match wins, and
   *  every tag in a set must be present on the element. Ordering is load-bearing
   *  for zh — see the profile — because a bare ['Mandarin','Pinyin'] match also
   *  catches regional readings. */
  pronunciationSoundTags?: string[][];
  /** Reject a romanisation candidate matching this (zh: tone-NUMBER systems.
   *  Standard pinyin writes tone as a diacritic, so a digit means the candidate
   *  is Wade-Giles, Sichuanese or another numbered scheme). */
  rejectPronunciationPattern?: RegExp;
  /** Readings that MUST come out of the built database, as word -> expected
   *  pronunciation string. The build fails on a mismatch.
   *
   *  This is the guard the zh dictionary lacked. Its keys were claimed by
   *  unrelated characters through kaikki's alternative-form rows, so it shipped
   *  `chī` for 这 and `jīn` for 当 to every reader for a whole release. Nothing
   *  in the build noticed, because the entry count and the coverage score were
   *  both healthy. Coverage asks whether a word RESOLVES. These ask whether the
   *  answer is right, which is the question nothing was asking.
   *
   *  Pick words a beginner meets in their first hour, with readings that are
   *  not in dispute. */
  readingInvariants?: Record<string, string>;
  /** Read the entry's pronunciation from the `ruby` field of the `canonical`
   *  form row, and not from `sounds[]` (ja only).
   *
   *  Furigana is the reading a Japanese learner needs, and `sounds[]` does not
   *  hold it. Measured on the full dump:
   *
   *    - `sounds[]` is a PHONETIC transcription. It answers がくせー for 学生 and
   *      とーきょー for 東京, where the furigana is がくせい and とうきょう. It
   *      disagrees in 16.3% of kanji entries.
   *    - A ja `sounds[]` tag is a REJECT signal, the inverse of zh. 99.3% of
   *      elements carry no tag, and every tagged one is regional. So
   *      `pronunciationSoundTags` would select only dialects.
   *    - `sounds[].ipa` is narrow phonetic IPA, [ɡa̠kɯ̟̊se̞ː], which no learner
   *      reads.
   *
   *  The ruby field resolves 99.95% of glossed content entries. See
   *  `rubyReading` for the four guards each failure needed. */
  readingFromRuby?: boolean;
  /** Drop an entry whose `pos` is in this list, however good its gloss (ja:
   *  'romanization').
   *
   *  22% of the glossed Japanese dump is `pos: 'romanization'`, and its
   *  headwords are LATIN: `name`, `on`, `A`, `chien`, each glossed 'Rōmaji
   *  transcription of …'. A learner reads kana and kanji, never these, and they
   *  would collide with real lookups. zh escaped this by choosing the /Chinese/
   *  dump over /Mandarin/, which was entirely romanization. Japanese publishes
   *  one dump, so the filter has to live here. */
  skipPos?: string[];
  /** Drop an entry that HAS sounds[] but none carrying this tag (zh:
   *  'Mandarin'). 8,145 entries are Cantonese-or-other-variety only — English
   *  loanwords like `book` and `van` — and they are not Mandarin words. An
   *  entry with no sounds at all is kept, since absence proves nothing. */
  requireSoundTag?: string;

  // --- Arabic-script levers (#253). Measured against the kaikki Arabic dump;
  // --- see the comments on the `ar` profile.

  /** Fold every key with `foldArabicKey` (ar): drop tashkeel and tatweel, and
   *  fold the alef spellings أ إ آ ٱ onto bare ا. Mirrors the runtime foldWord,
   *  which is the only reason a key can be hit at all — 8,991 headwords in the
   *  dump are spelled with أ where running text writes ا. */
  foldArabicKeys?: boolean;
  /** Read the entry's pronunciation from the `form` of its `canonical` form
   *  row, and not from `sounds[]` (ar).
   *
   *  Arabic runs the ja arrangement in reverse. The HEADWORD is unvocalized —
   *  only 30 of 77,339 carry a diacritic — and the vocalized spelling sits on
   *  the canonical row: أنا carries أَنَا, مرأة carries مَرْأَة. That vocalized
   *  spelling is the one thing an Arabic learner most needs from a lookup,
   *  because the script hides every short vowel, and it resolves 35,655 of the
   *  35,941 glossed entries (99.2%).
   *
   *  `sounds[]` cannot do this job: it covers 20,695 entries, and its tags are
   *  dialectal (Hijazi, Moroccan, Egyptian, Kuwaiti), so selecting from it
   *  would ship a regional reading for a Modern Standard Arabic pack. */
  readingFromCanonicalForm?: boolean;
  /** Which lemma's senses lead a folded key, as `key -> vocalized canonical
   *  form`, JSON relative to PROJECT_ROOT (ar).
   *
   *  Unvocalized Arabic spells several words the same way, so the senses of
   *  every colliding lemma merge under one key. Nothing is lost, but the ORDER
   *  is kaikki's etymology order, and for a short list of very frequent words
   *  that order leads with a rare verb: `لم` led with لَمَّ "to gather" instead
   *  of the negator لَمْ, `قد` with قَدَّ "to cut into strips" instead of the
   *  particle, and `ان` — the fourth most frequent word in the language — with
   *  آن "time" instead of the conjunction أَنْ.
   *
   *  A matching record moves to the FRONT and its reading wins. The build fails
   *  if a key here matches no record, so the map cannot rot silently against a
   *  later dump. See scripts/ar-lead-forms.json for what belongs in it. */
  leadFormsRel?: string;
  /** Register a leniently-folded variant of every key as an inflection alias,
   *  for the runtime fallback to hit ('arabic': arabicLooseKey, type
   *  'unpointed'). The Arabic sibling of markStrippedAliases, and the same
   *  mechanism: exact keys always win first, so this only answers a word that
   *  nothing else resolved. */
  looseAliases?: 'arabic';
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
  ar: {
    // Canonical /Arabic/ URL (kaikki has no /downloads/ar/ mirror; verified
    // 2026-08-25). 512 MB, 77,339 lines.
    kaikkiUrls: ['https://kaikki.org/dictionary/Arabic/kaikki.org-dictionary-Arabic.jsonl'],
    // The Arabic block, letters and marks: U+0621-U+063A is hamza through
    // ghain, U+0641-U+064A is fa through ya, U+064B-U+065F is the tashkeel and
    // the Quranic marks, U+0640 is the tatweel, U+0670 the superscript alef and
    // U+0671 the alef wasla. The Arabic-Indic digits U+0660-U+0669 are LEFT OUT
    // so they act as boundaries, matching the runtime tokenizer, and so are the
    // Arabic comma, semicolon and question mark. The marks are in the class
    // even though no key keeps one: a vocalized token out of a book has to pass
    // the letter test BEFORE the fold removes them.
    letterClass: '\\u0621-\\u063A\\u0640-\\u065F\\u0670\\u0671',
    // Arabic resolves through the pack's `morphology` slice, not through these.
    // The coverage lookup reads the pack directly, so the gate and the runtime
    // peel the same proclitics. See stemCandidates.
    prefixes: [],
    suffixes: [],
    // The three long vowels. Only the af-style affix machinery reads this, and
    // ar declares no affix rules, so nothing consults it.
    vowels: '\u0627\u0648\u064A',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-ar.txt',
    // 41,398 of 77,339 lines carry no English gloss, including the thesaurus
    // pages whose headwords are ENGLISH (`overweight`, glossed by a synonym
    // list and nothing else).
    glossFilter: true,
    // Tashkeel, tatweel and the alef spellings. This is the lever the whole
    // pack turns on: without it 8,991 أ-initial headwords key under a spelling
    // running text does not use.
    foldArabicKeys: true,
    // The vocalized spelling off the canonical row. 99.2% of glossed entries
    // have one, and it is what the script hides.
    readingFromCanonicalForm: true,
    // ة/ه and ى/ي, as alias rows rather than as keys.
    looseAliases: 'arabic',
    // Which lemma leads the dozen frequent keys where the dump leads with a
    // rare homograph.
    leadFormsRel: 'scripts/ar-lead-forms.json',
    // The guard the zh dictionary lacked, on the words this pack is most likely
    // to get wrong: a folded key with several lemmas behind it. Every one of
    // these is a first-hour word whose vocalization is not in dispute.
    readingInvariants: {
      ان: 'أَنْ',
      لم: 'لَمْ',
      قد: 'قَدْ',
      بعد: 'بَعْدَ',
      قبل: 'قَبْلَ',
      و: 'وَ',
      في: 'فِي',
      من: 'مِنْ',
      على: 'عَلَى',
      لا: 'لَا',
      هذا: 'هٰذَا',
      كان: 'كَانَ',
      كل: 'كُلّ',
      هو: 'هُوَ',
      هي: 'هِيَ',
    },
  },
  bn: {
    // Canonical /Bengali/ URL (kaikki has no /downloads/bn/ mirror; verified
    // 2026-08-31). 37.6 MB, 11,178 lines — the SMALLEST dump any pack builds
    // from, and the reason this profile sets `coverageThreshold`.
    kaikkiUrls: ['https://kaikki.org/dictionary/Bengali/kaikki.org-dictionary-Bengali.jsonl'],
    // The Bengali block, U+0980-U+09FE: independent vowels and consonants, the
    // dependent vowel signs (matras), the virama, the nuqta, the anusvara, the
    // chandrabindu, the visarga and the khanda ta. The marks are in the class
    // because a Bengali word is written as a consonant plus its matra and the
    // letter test sees the whole token. The Bengali digits U+09E6-U+09EF are
    // deliberately LEFT OUT so they act as boundaries, matching the runtime
    // tokenizer — ২০২৪ সালে is one word, not two.
    letterClass: '\\u0980-\\u09FE',
    // Bengali resolves through the pack's `morphology` slice, not through
    // these. The coverage lookup reads the pack directly, so the gate and the
    // runtime peel the same suffixes. See stemCandidates.
    prefixes: [],
    suffixes: [],
    // The independent vowels. Only the af-style affix machinery reads this, and
    // bn declares no affix rules, so nothing consults it.
    vowels: 'অআইঈউঊএঐওঔ',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-bn.txt',
    // 5 of 11,178 lines carry no English gloss. The filter is nearly a no-op
    // here, unlike ar (41,398 of 77,339), but it stays on so a later dump that
    // grows a thesaurus section cannot leak English headwords into a bn key.
    glossFilter: true,
    // 65%, against the 85% every other pack clears. This is a MEASUREMENT, not
    // a preference, and it is the whole reason the pack needed a decision.
    //
    // Measured 2026-08-31 against the top 5,000 wordfreq-bn tokens:
    //
    //   exact headword                 38.7%
    //   + the dump's inflection tables 55.8%
    //   + the pack's morphology slice  69.7%
    //
    // The ceiling is VOCABULARY, not morphology. A deliberately over-aggressive
    // peel that also stripped verb endings reached 71.4%, so 2 more points cost
    // every false stem the wider list invents. What is actually missing is the
    // Sanskrit-derived register a Bengali newspaper is written in, and English
    // Wiktionary does not have it: অনুষ্ঠিত (held), নিহত (killed), উদ্ধার
    // (rescue), উন্নয়ন (development), প্রতিষ্ঠান (institution), প্রযুক্তি
    // (technology), নিয়ন্ত্রণ (control), সংস্থা (organisation), চুক্তি (treaty).
    // Names and loans (বিএনপি, প্রেসিডেন্ট, টিভি) and informal spellings (কারন
    // for কারণ, ছিলো for ছিল) make up most of the rest.
    //
    // Coverage is much better on the words a learner meets first: 88.3% over
    // the top 1,000 and 81.8% over the top 2,000. It is the long tail of formal
    // vocabulary that fails, which is the right shape of failure for a reader
    // that falls back to AI translate on a miss.
    //
    // The gate is pinned 4.7 points below the measurement so a dump refresh
    // that loses ground still fails the build.
    coverageThreshold: 0.65,
  },
  cs: {
    // Canonical /Czech/ URL (kaikki has no /downloads/cs/ mirror; verified 2026-08-08).
    kaikkiUrls: ['https://kaikki.org/dictionary/Czech/kaikki.org-dictionary-Czech.jsonl'],
    // The Czech alphabet: a-z plus the háček letters č ď ě ň ř š ť ž, the acute
    // letters á é í ó ú ý, and ů (kroužek). q, v, w and x are marginal but stay
    // in the a-z range for the loanwords the dump carries. `ch` is a single
    // letter for collation only — it is two code points and needs nothing here.
    // The apostrophe is a token boundary, matching the runtime tokenizer: Czech
    // writes it only for dialectal elision, never inside a citation form, so it
    // is the pl/tr shape and the opposite of uk. Hyphen stays a word char for
    // compounds (česko-slovenský, modro-bílý).
    letterClass: 'a-záčďéěíňóřšťúůýžA-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ-',
    // No hand affix rules: Czech is fusional, so its 7 cases × 4 genders, verb
    // conjugation, aspect pairs and consonant alternations resolve via kaikki
    // "form of <lemma>" entries + the inflections table — the same strategy as
    // de/es/fr/nl/pt/ru/tr/uk/pl.
    prefixes: [],
    suffixes: [],
    // Czech distinguishes vowel length, so the acute forms are separate vowels,
    // not accented variants. ě is a vowel letter; ů is the long u written after
    // a historical diphthong.
    vowels: 'aáeéěiíoóuúůyý',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-cs.txt',
    glossFilter: true,
  },
  el: {
    // Canonical /Greek/ URL. Distinct from the Ancient Greek dump that grc uses.
    kaikkiUrls: ['https://kaikki.org/dictionary/Greek/kaikki.org-dictionary-Greek.jsonl'],
    // Greek and Coptic (Ͱ-Ͽ): base letters, tonos forms, and final sigma.
    // Hyphen stays a word char for editorial compounds.
    letterClass: 'Ͱ-Ͽ-',
    prefixes: [],
    suffixes: [],
    vowels: 'αεηιοωυάέήίόύώϊϋΐΰ',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-el.txt',
    glossFilter: true,
    // wordfreq and running text disagree with Wiktionary on the tonos and
    // on final sigma (της vs τησ). Alias the stripMarks form, as grc does.
    markStrippedAliases: true,
  },
  fi: {
    // Canonical /Finnish/ URL. 4.6 GB — Wiktionary generates full inflection
    // tables, so the streaming path is required, as for Latin.
    kaikkiUrls: ['https://kaikki.org/dictionary/Finnish/kaikki.org-dictionary-Finnish.jsonl'],
    letterClass: 'a-zäöA-ZÄÖ-',
    prefixes: [],
    suffixes: [],
    vowels: 'aeiouyäö',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-fi.txt',
    glossFilter: true,
    // Wiktionary generates every possessive stack (kirjassanikin). Those rows
    // blow the inflection map past V8's Map limit. Case and number stay.
    extraSkipFormTags: ['possessive', 'singular-possessive', 'plural-possessive'],
  },
  hu: {
    // Canonical /Hungarian/ URL.
    kaikkiUrls: ['https://kaikki.org/dictionary/Hungarian/kaikki.org-dictionary-Hungarian.jsonl'],
    // Acute and double-acute. Hyphen stays a word char for compounds.
    letterClass: 'a-záéíóöőúüűA-ZÁÉÍÓÖŐÚÜŰ-',
    prefixes: [],
    suffixes: [],
    vowels: 'aáeéiíoóöőuúüű',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-hu.txt',
    glossFilter: true,
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
  gd: {
    // Canonical /Scottish Gaelic/ URL (space in the path, concatenated filename).
    kaikkiUrls: [
      'https://kaikki.org/dictionary/Scottish%20Gaelic/kaikki.org-dictionary-ScottishGaelic.jsonl',
    ],
    // a-z plus grave vowels à è ì ò ù. Hyphen stays a word char for
    // an-diugh / a-màireach. Apostrophe stays a word char, matching the
    // pack's extraJoiners (a' bhean, 's, d'fhàg).
    letterClass: "a-zàèìòùA-ZÀÈÌÒÙ'-",
    // No hand affix rules. kaikki carries most inflected forms. Lenition
    // and h-/t- prothesis resolve through the pack's morphology slice.
    prefixes: [],
    suffixes: [],
    vowels: 'aeiouàèìòù',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-gd.txt',
    glossFilter: true,
    foldApostrophes: true,
    // 77%, against the 85% every other pack clears. Measured 2026-09-02
    // against the top 1,000 cleaned gd.wikipedia tokens: 78.2%. The dump
    // holds 16,909 entries and 24,548 senses. The misses are plurals
    // (tachartasan), contractions (th'ann, den), and place-name halves
    // (èideann, obar) that Wikipedia writes and kaikki does not list.
    coverageThreshold: 0.77,
  },
  hi: {
    // Canonical /Hindi/ URL (kaikki has no /downloads/hi/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Hindi/kaikki.org-dictionary-Hindi.jsonl'],
    // Devanagari letters and marks: U+0900–U+0963 covers the independent
    // vowels, consonants, nukta, virama and matras; U+0971–U+097F is the
    // additional-letter tail. Danda U+0964, double danda U+0965 and the
    // digits U+0966–U+096F are left out so they act as boundaries, matching
    // the runtime tokenizer. ZWJ/ZWNJ stay in so a conjunct that writes them
    // still passes the letter test.
    letterClass: '\\u0900-\\u0963\\u0971-\\u097F\\u200C\\u200D',
    // No hand affix rules: Hindi inflection is mild (gender, direct/oblique)
    // and kaikki carries the forms. Postpositions are separate words.
    prefixes: [],
    suffixes: [],
    // Independent vowels only. The affix machinery does not run for hi.
    vowels: 'अआइईउऊऋएऐओऔ',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-hi.txt',
    glossFilter: true,
  },
  id: {
    // Canonical /Indonesian/ URL (kaikki has no /downloads/id/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Indonesian/kaikki.org-dictionary-Indonesian.jsonl'],
    // Plain Latin. Official spelling has no diacritics. Hyphen stays a word
    // char for reduplicated plurals (buku-buku) and compounds. The apostrophe
    // is a token boundary, matching the runtime tokenizer and the pl/cs shape.
    letterClass: 'a-zA-Z-',
    // No hand affix rules in v1. kaikki carries most meN-/ber-/di-/ter-
    // derived forms as their own entries. A sandhi-aware prefix strip is the
    // fallback if the coverage gate shows it is needed.
    prefixes: [],
    suffixes: [],
    vowels: 'aeiou',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-id.txt',
    glossFilter: true,
  },
  it: {
    // Canonical /Italian/ URL (kaikki has no /downloads/it/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Italian/kaikki.org-dictionary-Italian.jsonl'],
    // Italian diacritics found in native text and loanwords. The apostrophe
    // is a word character (C'è, l'italiano, un'amica), matching the runtime
    // tokenizer's extraJoiners. Hyphen remains a word char.
    letterClass: "a-zàèéìíîòóùA-ZÀÈÉÌÍÎÒÓÙ'-",
    // No hand affix rules: Italian form-of entries and the inflections table
    // resolve conjugated and plural surface forms, as for de/es/fr/nl.
    prefixes: [],
    suffixes: [],
    vowels: 'aeiouàèéìíîòóù',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-it.txt',
    glossFilter: true,
    // Keys carry one apostrophe spelling, matching the pack's script.foldApostrophes.
    foldApostrophes: true,
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
  sv: {
    // Canonical /Swedish/ URL (kaikki has no /downloads/sv/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Swedish/kaikki.org-dictionary-Swedish.jsonl'],
    // a-z plus å ä ö. The apostrophe is a token boundary, matching the
    // runtime tokenizer and the pl/cs/id shape. Hyphen stays a word char for
    // compounds (sjukhusparkering is written solid; hyphenated loans stay whole).
    letterClass: 'a-zåäöA-ZÅÄÖ-',
    // No hand affix rules: the definite suffix (hus → huset) and verb forms
    // resolve via kaikki form-of entries + the inflections table.
    prefixes: [],
    suffixes: [],
    vowels: 'aeiouyåäö',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-sv.txt',
    glossFilter: true,
  },
  la: {
    // Canonical /Latin/ URL. 1.1 GB / ~840k words — Wiktionary's Latin
    // inflection coverage is near-total, so the streaming path is required.
    kaikkiUrls: ['https://kaikki.org/dictionary/Latin/kaikki.org-dictionary-Latin.jsonl'],
    // a-z plus the macronized and ligatured display forms the dump prints
    // (ā ē ī ō ū æ œ). Keys strip those marks; this class only feeds the
    // coverage tokenizer. Hyphen stays a word char for editorial compounds.
    letterClass: 'a-zāēīōūȳăĕĭŏŭæœA-ZĀĒĪŌŪȲĂĔĬŎŬÆŒ-',
    // No hand affix rules: five declensions and the full verb system resolve
    // via kaikki form-of entries + the inflections table (#256).
    prefixes: [],
    suffixes: [],
    vowels: 'aeiouyāēīōūȳăĕĭŏŭæœ',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-la.txt',
    glossFilter: true,
    // Dictionaries mark vowel length. Running text almost never does.
    // Strip macrons and breves from keys; keep them out of the popover
    // display only when the dump stored them on a non-key field.
    stripFromKeys: /[\u0304\u0306]/g,
    // æ/œ unfold so Cæsar and Caesar are one key, matching foldLatinKey.
    unfoldLigatures: true,
  },
  pl: {
    // Canonical /Polish/ URL (kaikki has no /downloads/pl/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Polish/kaikki.org-dictionary-Polish.jsonl'],
    // The 32-letter Polish alphabet: a-z plus ą ć ę ł ń ó ś ź ż. q, v and x are
    // not Polish letters but stay in the a-z range for the loanwords the dump
    // carries. The apostrophe is a token boundary, matching the runtime
    // tokenizer: a case ending on a foreign stem is written Kennedy'ego, which
    // splits to Kennedy + ego and leaves the lookupable name on its own — the
    // same shape as tr, and the opposite of uk. Hyphen stays a word char for
    // compounds (biało-czerwony, polsko-angielski).
    letterClass: 'a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ-',
    // No hand affix rules: Polish's rich inflection (7 cases × 3 genders, verb
    // conjugation + aspect pairs, consonant alternations) resolves via kaikki
    // "form of <lemma>" entries + the inflections table, same strategy as
    // de/es/fr/nl/pt/ru/tr/uk.
    prefixes: [],
    suffixes: [],
    // Polish has no long/short vowel distinction; ą and ę are nasal vowels.
    vowels: 'aąeęioóuy',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-pl.txt',
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
  tr: {
    // Canonical /Turkish/ URL (kaikki has no /downloads/tr/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Turkish/kaikki.org-dictionary-Turkish.jsonl'],
    // The 29-letter Turkish alphabet: a-z minus q/w/x (kept anyway for
    // loanwords the dump carries) plus \u00e7 \u011f \u0131 i\u0307/\u0130 \u00f6 \u015f \u00fc. The apostrophe is a
    // token boundary, matching the runtime tokenizer: a suffix on a proper
    // noun is written \u0130stanbul'da, which splits to \u0130stanbul + da and leaves
    // the lookupable noun on its own. Hyphen stays a word char.
    letterClass: 'a-z\u00e7\u011f\u0131\u00f6\u015f\u00fcA-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc-',
    // No hand affix rules. Turkish is agglutinative, so a surface form can
    // stack several suffixes (ev-ler-imiz-den) and no fixed suffix list would
    // cover it; the dump's "form of <lemma>" entries plus the inflections
    // table resolve what kaikki records, and the runtime falls through to
    // UDPipe \u2192 AI for the rest, as for de/es/fr/nl/pt/ru.
    prefixes: [],
    suffixes: [],
    // The eight vowels, in the two harmony sets: back a \u0131 o u, front e i \u00f6 \u00fc.
    vowels: 'ae\u0131io\u00f6u\u00fc',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-tr.txt',
    glossFilter: true,
    // Dotted/dotless i: keys must fold I \u2192 \u0131 and \u0130 \u2192 i, matching the pack's
    // script.caseFoldLocale, or one word would key under two spellings.
    caseFoldLocale: 'tr',
  },
  uk: {
    // Canonical /Ukrainian/ URL (kaikki has no /downloads/uk/ mirror).
    kaikkiUrls: ['https://kaikki.org/dictionary/Ukrainian/kaikki.org-dictionary-Ukrainian.jsonl'],
    // The 33-letter Ukrainian alphabet. а-щ is contiguous, then ь ю я; ъ ы э sit
    // inside that span and are Russian-only, so they are left out and a leaked
    // Russian token fails the letter test. ґ є і ї are outside the range and
    // are added explicitly. The apostrophe IS a word character here (зв'язку,
    // п'ять) — unlike ru, where it is not Russian orthography, and unlike tr,
    // where it is a suffix boundary. Hyphen stays a word char for compounds
    // (будь-який, все-таки).
    letterClass: "а-щьюяґєіїА-ЩЬЮЯҐЄІЇ'-",
    // No hand affix rules: Ukrainian's inflection (7 cases × 3 genders, verb
    // conjugation + aspect pairs) resolves via kaikki "form of <lemma>" entries
    // + the inflections table, same strategy as de/es/fr/nl/pt/ru/tr.
    prefixes: [],
    suffixes: [],
    vowels: 'аеєиіїоуюя',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-uk.txt',
    glossFilter: true,
    // Ukrainian headwords carry the lexical-stress acute (молоко́) exactly as
    // Russian ones do, but running text is unstressed — a stressed key would
    // never be hit.
    stripFromKeys: /[\u0300\u0301]/g,
    // Keys carry one apostrophe spelling, matching the pack's script.foldApostrophes.
    foldApostrophes: true,
  },
  zh: {
    // The /Chinese/ dump, NOT /Mandarin/ (#213). The Mandarin dump is 92 MB
    // against Chinese's 1.1 GB and looks like the obvious pick, but every one
    // of its pages is `pos: "romanization"` \u2014 bare pinyin syllables with zero
    // Han headwords. The real data is only here. Measured 2026-08-09: 325,507
    // entries, 313,289 with a Han headword.
    kaikkiUrls: ['https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl'],
    // CJK Unified Ideographs + Extension A + the compatibility block, plus the
    // Latin range for the loanwords and letter entries the dump carries with
    // real Mandarin readings (A \u2192 \u0113i). Astral extensions are deliberately out:
    // they are rare enough in learner text to not justify the surrogate
    // handling, and the tokenizer keeps them whole regardless.
    letterClass: 'a-zA-Z\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF',
    // No affix morphology: Chinese does not inflect. Aspect and mood are
    // separate particles (\u4e86, \u7740, \u8fc7), which the tokenizer keeps as their own
    // tokens, so there is nothing to strip.
    prefixes: [],
    suffixes: [],
    // Pinyin vowels, for the coverage tokenizer's syllable heuristics. Han
    // characters carry no vowel letters, so this only ever sees romanised text.
    vowels:
      'aeiou\u00fc\u0101\u00e1\u01ce\u00e0\u0113\u00e9\u011b\u00e8\u012b\u00ed\u01d0\u00ec\u014d\u00f3\u01d2\u00f2\u016b\u00fa\u01d4\u00f9\u01d6\u01d8\u01da\u01dc',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-zh.txt',
    // 123,743 soft-redirects and 132,405 gloss-less entries \u2014 about 40% of the
    // dump. The filter is what makes the 1.1 GB tractable.
    glossFilter: true,

    // --- Unspaced-CJK levers, each measured against the dump.
    // 1,603 Simplified forms are a single character, and a single Han character
    // is a real word. The default floor of 2 would drop every one of them.
    minInflectionLength: 1,
    // \u95c6's Traditional form is the junk \u2ff5\u9580\ud842\udfee, tagged `nonstandard simp.`. Naive
    // tag matching picks it over the real form.
    skipFormRawTags: ['nonstandard simp.'],
    // Ideographic Description Characters U+2FF0\u2013U+2FFB. kaikki uses them to
    // DESCRIBE a glyph it cannot encode, so \u2ff5\u9580\ud842\udfee is a picture of a character
    // rather than a word, and it must never become a key.
    skipFormPattern: /[\u2ff0-\u2ffb]/u,
    // A defunct 1977 simplification scheme, 821 rows. Nobody reads it.
    extraSkipFormTags: ['Second-Round-Simplified-Chinese'],
    // Key on Simplified, alias the headword, and take the conversion from
    // OpenCC. See the note on `t2sMapRel` for why the dump's own Simplified
    // rows cannot be trusted to decide a key.
    t2sMapRel: 'scripts/zh-t2s-map.json',
    // Ranked readings for single characters. See the note on the lever.
    readingMapRel: 'scripts/zh-readings.json',
    // Pinyin, not Sinological IPA. It is what a learner reads, and the ruby
    // layer (#289 4.4) renders it. 166,940 entries carry it.
    //
    // The ORDER matters. A bare ['Mandarin','Pinyin'] match also catches
    // regional readings: 板 offers Chengdu 'ban³', Xi'an 'bàn' and Nanjing
    // 'bǎn' under exactly those two tags, alongside the standard 'bǎn'. Asking
    // for Standard-Chinese first is what keeps a dialect out of the entry.
    pronunciationSoundTags: [
      ['Mandarin', 'Standard-Chinese', 'Pinyin'],
      ['Mandarin', 'Standard', 'Pinyin'],
      ['Mandarin', 'Pinyin'],
    ],
    // Standard pinyin writes tone as a diacritic, so a digit means a numbered
    // scheme (Wade-Giles 'pan³', Sichuanese 'ban³'). Belt to the ordering's
    // braces: it stops such a form winning the last tier by looking clean.
    rejectPronunciationPattern: /[0-9¹²³⁴⁵]/u,
    // 8,145 entries have sounds but no Mandarin one \u2014 other-variety words,
    // mostly Cantonese English loans (`book`, `van`). Not Mandarin vocabulary.
    requireSoundTag: 'Mandarin',
    // All of these were wrong in the release built before the OpenCC re-key,
    // apart from 我, 好 and 那. See the note on `t2sMapRel`.
    //
    // A true polyphone cannot be an invariant, because it has no single right
    // answer. 调 is tiáo in 空调 and diào in 调查, and 参 is cān in 参加 and
    // shēn in 人参. The build answers tiáo and shēn, both of which are real
    // readings — picking the one a beginner meets first is a separate problem
    // from keying the entry on the right character, and it is not this lever's
    // to solve. Every word below reads one way in practice.
    readingInvariants: {
      我: 'wǒ',
      好: 'hǎo',
      那: 'nà',
      // The three most frequent characters that shipped a wrong reading. 的 is
      // the most frequent character in the language.
      的: 'de',
      都: 'dōu',
      还: 'hái',
      听: 'tīng',
      万: 'wàn',
      这: 'zhè',
      当: 'dāng',
      却: 'què',
      业: 'yè',
      农: 'nóng',
      气: 'qì',
      儿: 'ér',
      众: 'zhòng',
      马: 'mǎ',
      满: 'mǎn',
      码: 'mǎ',
      吗: 'ma',
      陆: 'lù',
      你好: 'nǐ hǎo',
      // The Traditional spellings, which resolve through a headword alias
      // rather than an entry of their own. They were wrong for a different
      // reason than the Simplified keys — an alternative-form row outranked the
      // alias — so they are worth naming separately.
      這: 'zhè',
      當: 'dāng',
      農: 'nóng',
      滿: 'mǎn',
    },
  },
  ja: {
    // #214. 329 MB, 198,703 lines. Japanese publishes ONE dump, unlike Chinese,
    // so every filter has to live in this profile.
    kaikkiUrls: ['https://kaikki.org/dictionary/Japanese/kaikki.org-dictionary-Japanese.jsonl'],
    // Kana AND kanji. Hiragana, katakana with the prolonged sound mark U+30FC,
    // the iteration mark U+3005, the Han ranges, and Latin for the loanwords the
    // dump carries. A Han-only class would drop every kana word, and ください and
    // です are words a learner taps constantly.
    letterClass:
      'a-zA-Z\\u3041-\\u309F\\u30A0-\\u30FF\\u3005\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF',
    // Japanese marks grammar with particles and auxiliaries, not affixes, and
    // kaikki resolves inflection through `forms`. So the affix heuristics stay
    // empty, exactly as they are for de.
    prefixes: [],
    suffixes: [],
    vowels: 'aeiou',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-ja.txt',
    // 54,087 of 198,703 lines carry no English gloss. That is the natural size
    // lever, as it is for de.
    glossFilter: true,
    // A single kanji is a real word: 本, 人, 水. The same reason zh sets 1.
    minInflectionLength: 1,
    // An Ideographic Description Character means kaikki is drawing a glyph it
    // cannot encode, so the string is a picture and never a key. Shared with zh.
    skipFormPattern: /[⿰-⿻]/u,
    // 31,912 romaji entries whose headwords are Latin words. See skipPos.
    skipPos: ['romanization'],
    // Furigana from the canonical ruby row. See readingFromRuby for why
    // sounds[] is the wrong source.
    readingFromRuby: true,
    // Each of these is a word from a first lesson, and each takes one reading.
    // 東京 earns its place because sounds[] answers とーきょー for it, which is
    // exactly what this gate exists to catch.
    readingInvariants: {
      日本: 'にほん',
      東京: 'とうきょう',
      学生: 'がくせい',
      図書館: 'としょかん',
      勉強: 'べんきょう',
      先生: 'せんせい',
      毎日: 'まいにち',
      新しい: 'あたらしい',
      食べる: 'たべる',
      読む: 'よむ',
      お母さん: 'おかあさん',
    },
  },
  ko: {
    // #289. 199 MB, 62,970 lines. Korean publishes ONE dump.
    kaikkiUrls: ['https://kaikki.org/dictionary/Korean/kaikki.org-dictionary-Korean.jsonl'],
    // Precomposed Hangul syllables and the Han ranges. Hangul is what a reader
    // meets, and Han earns its place because the dump gives a Sino-Korean noun
    // its hanja spelling as a form row: 도서관 lists 圖書館.
    letterClass: '\\uAC00-\\uD7A3\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF',
    // Korean resolves through the pack's `morphology` slice, not through
    // these. The coverage lookup reads the pack directly, so the gate and the
    // runtime peel the same postpositions. See stemCandidates.
    prefixes: [],
    suffixes: [],
    vowels: 'aeiou',
    rootsJsonRel: null,
    coverageCorpusRel: 'scripts/coverage-corpus-ko.txt',
    // 6,686 of 62,970 lines carry no English gloss.
    glossFilter: true,
    // 377 entries with pos 'syllable' hold 8,774 senses between them, and every
    // sense is an index of a Middle Chinese reading rather than a definition.
    // They key on a bare syllable, so they displace the real word: 눈, 정, 의 and
    // 기 are all common nouns AND all syllables in that table.
    skipPos: ['syllable'],
    // The three romanization schemes kaikki writes as form rows. 15,063 rows of
    // Latin text that can never be a Korean key. The shared list already drops
    // the rows tagged 'romanization', which is 58,355 more.
    extraSkipFormTags: ['revised', 'McCune-Reischauer', 'Yale'],
    // An Ideographic Description Character means kaikki is drawing a glyph it
    // cannot encode, so the string is a picture and never a key. Shared with
    // zh and ja, and it reaches ko through the hanja form rows.
    skipFormPattern: /[\u2FF0-\u2FFB]/u,
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

/**
 * Traditional-to-Simplified conversion for the entry key (zh). Generated from
 * OpenCC — see `t2sMapRel` and scripts/gen-zh-t2s-map.py.
 *
 * `words` holds the headwords where converting character by character
 * disagrees with OpenCC on the whole string, which is what OpenCC's phrase
 * rules are for: 乾 alone is 干, but 乾隆 keeps 乾. So the phrase table is
 * consulted first and the character table fills in the rest.
 */
interface T2sMap {
  chars: Record<string, string>;
  words: Record<string, string>;
}

const T2S_MAP: T2sMap | null = PROFILE.t2sMapRel
  ? (JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, PROFILE.t2sMapRel), 'utf-8')) as T2sMap)
  : null;

/**
 * Dominant reading per single character (zh). See `readingMapRel`.
 */
const READING_MAP: Record<string, string> | null = PROFILE.readingMapRel
  ? (JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, PROFILE.readingMapRel), 'utf-8')) as Record<
      string,
      string
    >)
  : null;

/**
 * Which lemma leads a folded key (ar). See `leadFormsRel`. Keys prefixed with
 * `_` are documentation inside the JSON and are not lookup keys.
 */
const LEAD_FORMS: Record<string, string> | null = PROFILE.leadFormsRel
  ? Object.fromEntries(
      Object.entries(
        JSON.parse(
          fs.readFileSync(path.join(PROJECT_ROOT, PROFILE.leadFormsRel), 'utf-8'),
        ) as Record<string, unknown>,
      ).filter(([key, value]) => !key.startsWith('_') && typeof value === 'string') as Array<
        [string, string]
      >,
    )
  : null;

/** Keys from LEAD_FORMS that actually matched a record. Checked after the
 *  stream, because a key that matches nothing is a map gone stale. */
const leadsMatched = new Set<string>();

/** True for a string of exactly one codepoint, astral characters included. */
function isSingleChar(word: string): boolean {
  const chars = [...word];
  return chars.length === 1;
}

function toSimplified(word: string): string {
  if (!T2S_MAP) return word;
  const phrase = T2S_MAP.words[word];
  if (phrase) return phrase;
  let out = '';
  for (const ch of word) out += T2S_MAP.chars[ch] ?? ch;
  return out;
}

// Affix-stripping constants — MUST mirror src/lib/dictionary.ts so the coverage
// check reflects what the live lookup will see. Empty for languages (de) that
// resolve inflections via the kaikki `forms` table instead of affix rules.
const PREFIXES = PROFILE.prefixes;
const SUFFIXES = PROFILE.suffixes;
const MORPHOLOGY = isValidLanguageCode(LANG) ? LANGUAGES[LANG].morphology : undefined;
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
      const partial = `${CACHE_PATH}.part`;
      await pipeline(
        Readable.fromWeb(res.body as import('stream/web').ReadableStream),
        fs.createWriteStream(partial),
      );
      fs.renameSync(partial, CACHE_PATH);
      const sizeMb = fs.statSync(CACHE_PATH).size / 1024 / 1024;
      console.log(`  wrote ${sizeMb.toFixed(2)} MB to ${CACHE_PATH}`);
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
  /** ar: this record is the lemma `leadFormsRel` names for its key. */
  leads?: boolean;
}

interface KaikkiSound {
  ipa?: string;
  /** The CJK dumps carry romanisations here rather than in `ipa` (zh: Pinyin,
   *  Bopomofo, Wade-Giles… each as its own sounds[] element, distinguished by
   *  `tags`). */
  zh_pron?: string;
  tags?: string[];
}
interface KaikkiSense {
  glosses?: string[];
}
interface KaikkiForm {
  form?: string;
  tags?: string[];
  /** Free-text qualifiers kaikki could not map onto a tag. zh uses it for
   *  'nonstandard simp.', which marks a form that must never become a key. */
  raw_tags?: string[];
  /** Furigana, on the ja `canonical` row: one [base, reading] pair per kanji
   *  run. 学生 carries [['学','がく'],['生','せい']]. */
  ruby?: string[][];
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

// Kana, the prolonged sound mark, and the punctuation a multi-word reading
// carries. A reading outside this set did not rebuild cleanly.
const JA_READING_OK = /^[\u3041-\u309F\u30A0-\u30FF\u30FC\u3000-\u303F.\-\s]+$/u;
const JA_KANJI = /[\u3400-\u4DBF\u4E00-\u9FFF]/u;

/**
 * Full kana reading for a headword, from the `ruby` pairs on its `canonical`
 * form row. Returns undefined when it cannot be rebuilt exactly.
 *
 * The walk goes left to right. Where the next pair matches at the cursor, emit
 * its reading and skip the base. Otherwise emit the character, which is how a
 * kana tail survives: お母さん with [['母','かあ']] rebuilds to おかあさん.
 *
 * Four guards, each from a real failure on the full dump:
 *
 *  1. A pair covering the WHOLE headword wins. 主体思想 carries both per-character
 *     pairs and a whole-word pair, and the per-character walk gives しゅたいしそう
 *     where the word reads チュチェしそう.
 *  2. Trim each base. `C++ ` and `π/ ` carry a trailing space.
 *  3. Allow punctuation. 病は口より入り、禍は口より出ず rebuilds correctly and holds 、.
 *  4. Reject an unconsumed pair. 繩索 is kyūjitai while its bases are shinjitai,
 *     so no match is possible. A PARTIAL reading is worse than none, which is
 *     the lesson the zh pack paid for.
 *
 * Measured over 106,756 glossed content entries: 78,336 rebuild here, 28,370
 * need nothing because the headword is already kana, and 50 resolve to nothing.
 */
function rubyReading(word: string, forms: KaikkiForm[] | undefined): string | undefined {
  const canonical = forms?.find((f) => f.tags?.includes('canonical') && f.ruby);
  if (!canonical?.ruby) return undefined;

  const pairs: Array<[string, string]> = [];
  for (const pair of canonical.ruby) {
    // GUARD 2.
    const base = (pair[0] ?? '').trim();
    const reading = (pair[1] ?? '').trim();
    if (base && reading) pairs.push([base, reading]);
  }
  if (pairs.length === 0) return undefined;

  // GUARD 1.
  for (const [base, reading] of pairs) {
    if (base === word) return reading;
  }

  let out = '';
  let i = 0;
  let pi = 0;
  while (i < word.length) {
    if (pi < pairs.length && word.startsWith(pairs[pi][0], i)) {
      out += pairs[pi][1];
      i += pairs[pi][0].length;
      pi += 1;
      continue;
    }
    out += word[i];
    i += 1;
  }

  // GUARD 4.
  if (pi !== pairs.length) return undefined;
  // GUARD 3 is the character class. A reading still holding kanji did not resolve.
  if (!JA_READING_OK.test(out) || JA_KANJI.test(out)) return undefined;
  return out;
}

// Arabic tashkeel. A canonical row without one of these is not a vocalization,
// so there is nothing for a learner to read off it.
const AR_TASHKEEL = /[\u064B-\u0652]/u;

/** A vocalized Arabic word and nothing else: letters, tashkeel, tatweel. */
const AR_WORD_ONLY = /^[\u0621-\u065F\u0670\u0671]+$/u;

/**
 * The vocalized spelling of the headword, from the `form` of its `canonical`
 * form row (ar). See `readingFromCanonicalForm` for why this and not sounds[].
 *
 * Three guards, each from the dump:
 *
 *  1. Take the FIRST canonical row. 1,177 entries carry more than one, and the
 *     extras are gender or number variants of the same lemma rather than rival
 *     readings, so first is the citation form.
 *  2. Take the first WHITESPACE-SEPARATED token of it, and require the token to
 *     be Arabic. 30 canonical rows have kaikki's own annotations leaked into
 *     them: قبل carries `قَبْلَ Audio:`, يتم carries `يَتِمَ I يَتُمَ I يَتَمَ`
 *     and one row is the bare string `IPA⁽ᵏᵉʸ⁾:`. قبل is a top-30 word, so this
 *     is not an edge case a learner never reaches.
 *  3. Require a diacritic. 286 glossed entries carry no canonical row at all,
 *     and the letter-name entries carry an unvocalized one (`و / و`), which
 *     would print the word above itself and tell the learner nothing.
 *
 * What this cannot fix is genuine ambiguity across ENTRIES. جهاد is two
 * entries, جِهَاد and جَهَاد, whose senses merge under one unvocalized key, and
 * the merge keeps the first reading it meets. That is inherent to a script
 * that omits its vowels, and it is the reason this pack ships no reader ruby
 * annotation: one vocalization printed above every word would state a reading
 * the text does not fix. In the lookup it sits beside every merged sense,
 * where it reads as one candidate and not as the answer. `leadFormsRel` decides
 * WHICH candidate leads for the words where the dump's order is wrong.
 */
function canonicalForm(forms: KaikkiForm[] | undefined): string | undefined {
  const canonical = forms?.find((f) => f.tags?.includes('canonical') && f.form);
  const form = canonical?.form?.trim().split(/\s+/)[0];
  if (!form || !AR_WORD_ONLY.test(form) || !AR_TASHKEEL.test(form)) return undefined;
  return form;
}

function pickIpa(sounds: KaikkiSound[] | undefined): string | undefined {
  if (!sounds) return undefined;
  // A romanisation beats the IPA where the profile asks for one (zh: pinyin is
  // what a learner reads, and the ruby layer needs it). Tag-sets are tried in
  // order, so the standard reading wins over a regional one.
  for (const wanted of PROFILE.pronunciationSoundTags || []) {
    const romanised = pickRomanisation(sounds, wanted);
    if (romanised) return romanised;
  }
  for (const s of sounds) {
    if (s.ipa) return s.ipa;
  }
  return undefined;
}

/**
 * The cleanest romanisation carrying every `wanted` tag.
 *
 * kaikki's Mandarin pinyin needs two rounds of cleaning, and 板 shows both. Its
 * ['Mandarin','Pinyin'] elements are:
 *
 *   'bǎn (ban³)'  Standard, Pinyin          ← standard reading, dirty
 *   'ban³'        Chengdu, Sichuanese       ← a DIALECT, and it looks clean
 *   'bàn'         Xi'an                     ← a dialect
 *   'bǎn'         Nanjing                   ← a dialect
 *   'bǎn'         Standard-Chinese, Pinyin  ← what we want
 *
 * So a bare tag match is not enough: the caller tries `Standard-Chinese` first.
 * Within a tier, a value with no parentheses is the clean one, and the
 * parenthesised tone gloss is stripped only when every candidate carries it.
 * `rejectPronunciationPattern` then drops tone-NUMBER schemes outright, so a
 * dialect or Wade-Giles form cannot win the last tier by looking clean.
 */
function pickRomanisation(sounds: KaikkiSound[], wanted: string[]): string | undefined {
  const reject = PROFILE.rejectPronunciationPattern;
  const candidates = sounds
    .filter((s) => s.zh_pron && wanted.every((tag) => s.tags?.includes(tag)))
    // kaikki writes a tone-sandhi note as an unterminated bracket, so 日本語
    // arrives as `Rìběnyǔ [Phonetic: rìbényǔ`. The reading is the part in front.
    // 3,461 values carry one, and 2,597 of those sit on the tag set zh prefers,
    // so the note reached the shipped column.
    .map((s) => s.zh_pron!.replace(/\s*\[.*$/u, '').trim())
    .filter(Boolean)
    .filter((value) => !reject?.test(value));
  if (candidates.length === 0) return undefined;
  const clean = candidates.find((value) => !value.includes('('));
  if (clean) return clean;
  const stripped = candidates[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (!stripped || reject?.test(stripped)) return undefined;
  return stripped;
}

// Dictionary keys are NFC + lowercase (#289): must match the runtime foldWord
// (languages/text.ts) or decomposed dump data would never be hit by lookups.
// Profiles may additionally strip combining marks the dump carries but runtime
// text doesn't (ru lexical stress, grc vowel-length macrons/breves). The strip
// runs on the NFD form so precomposed carriers are caught too (Greek Extended
// has precomposed alpha-with-macron, ᾱ = U+1FB1); the final NFC recomposes
// legitimate mark-bearing letters (ё, й, breathings/accents) untouched — their
// marks aren't in any profile's strip set.
// Lowercase the way the runtime foldWord does for this language: locale-aware
// only for packs that ask for it (tr: I → ı, İ → i), plain Unicode otherwise.
// A locale fold can decompose (İ → i + U+0307), so re-normalize after it.
function lowerForLang(s: string): string {
  const locale = PROFILE.caseFoldLocale;
  return locale ? s.toLocaleLowerCase(locale).normalize('NFC') : s.toLowerCase();
}

// Mirrors languages/text.ts foldApostrophesFor — keep the two character sets
// identical, or a Ukrainian headword written with one variant would key under a
// spelling the runtime never produces.
const APOSTROPHE_VARIANTS = /[‘’ʼʹ`´]/g;

function foldKey(s: string): string {
  const normalized = PROFILE.foldApostrophes
    ? s.normalize('NFC').replace(APOSTROPHE_VARIANTS, "'")
    : s.normalize('NFC');
  const folded = lowerForLang(normalized).trim();
  const stripped = PROFILE.stripFromKeys
    ? folded.normalize('NFD').replace(PROFILE.stripFromKeys, '').normalize('NFC')
    : folded;
  // ar cannot use stripFromKeys for this. That lever strips on the NFD form,
  // and NFD takes أ apart into ا + U+0654 — but it also takes ؤ apart into
  // و + U+0654 and ئ into ي + U+0654. A strip wide enough to fold the alef
  // would silently fold the waw and the ya as well, so foldArabicKey names the
  // four alef spellings instead.
  if (PROFILE.foldArabicKeys) return foldArabicKey(stripped);
  if (!PROFILE.unfoldLigatures) return stripped;
  return stripped.replace(/æ/g, 'ae').replace(/œ/g, 'oe');
}

function extractEntry(raw: KaikkiLine): ExtractedEntry | null {
  if (!raw.word) return null;

  // Variety filter (zh). An entry with sounds[] but none tagged Mandarin is a
  // word of another Chinese variety, not a Mandarin one — 8,145 of them, mostly
  // Cantonese English loans (`book`, `van`). An entry with NO sounds at all is
  // kept: absence proves nothing.
  const required = PROFILE.requireSoundTag;
  if (required && raw.sounds && raw.sounds.length > 0) {
    if (!raw.sounds.some((s) => s.tags?.includes(required))) return null;
  }

  // The pattern that disqualifies a form disqualifies a HEADWORD too: an
  // Ideographic Description Character means the dump is drawing a glyph it
  // cannot encode, so the string is a picture and never a lookup key. 10 such
  // entries reach this point in the Chinese dump.
  if (PROFILE.skipFormPattern?.test(raw.word)) return null;

  // A part of speech the pack never wants, however good the gloss. See skipPos.
  if (raw.pos && PROFILE.skipPos?.includes(raw.pos)) return null;

  const headword = foldKey(raw.word);
  if (!headword) return null;

  // Script re-keying (zh). Convert the headword to Simplified and key on that,
  // then alias the headword below, so text in either script resolves. A
  // headword that is already Simplified converts to itself and keeps its key.
  //
  // The conversion comes from OpenCC through the generated map, and never from
  // the dump's own Simplified rows — see the note on `t2sMapRel`.
  let word = headword;
  if (T2S_MAP) {
    const simplified = foldKey(toSimplified(headword));
    if (simplified) word = simplified;
  }

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
    if (f.tags?.some((t) => PROFILE.extraSkipFormTags?.includes(t))) continue;
    if (f.raw_tags?.some((t) => PROFILE.skipFormRawTags?.includes(t))) continue;
    if (PROFILE.skipFormPattern?.test(f.form)) continue;
    const inflected = foldKey(f.form);
    if (!inflected || inflected === word) continue;
    // Skip non-Afrikaans-form rows (table headers, no-form rows). zh lowers the
    // floor to 1: a single Han character is a real word, and 1,603 of its
    // Simplified forms are one character long.
    const minLength = PROFILE.minInflectionLength ?? 2;
    if (inflected.includes(' ') || inflected.length < minLength) continue;
    const type = (f.tags || []).join(',') || 'form';
    inflections.push({ inflected, type });
  }

  // The headword becomes an alias when the entry was re-keyed onto a form, so
  // Traditional text still resolves to the Simplified-keyed entry.
  if (word !== headword && !headword.includes(' ')) {
    inflections.push({ inflected: headword, type: 'headword' });
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
    // zh: keyed on `word`, the Simplified form, because that is the character
    // the reader shows, so every record for one character answers the same
    // reading and the merge order stops mattering.
    // ja: furigana off the `canonical` ruby row, never sounds[].
    ipa: PROFILE.readingFromRuby
      ? rubyReading(raw.word, raw.forms)
      : PROFILE.readingFromCanonicalForm
        ? canonicalForm(raw.forms)
        : ((isSingleChar(word) ? READING_MAP?.[word] : undefined) ?? pickIpa(raw.sounds)),
    // ar: whether this record is the one leadFormsRel names for its key.
    // Compare against the canonical form, which for this pack IS what `ipa`
    // holds. The named-key test is separate on purpose: a bare equality check
    // reads `undefined === undefined` as a match, which made every one of the
    // 21,924 records with no canonical row claim the lead.
    leads: LEAD_FORMS?.[word] !== undefined && LEAD_FORMS[word] === canonicalForm(raw.forms),
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
  /** How many senses at the front came from a `leadFormsRel` match, so a second
   *  matching record lands after the first instead of ahead of it. */
  leadSenses?: number;
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
    if (ex.leads) {
      // The lemma leadFormsRel names goes to the FRONT of the merged key, and
      // its reading overrides whatever a record met earlier had. Several
      // records can share the named form (إِلَّا is both a conj and a prep), so
      // they queue behind each other rather than each jumping to position 0.
      const at = merged.leadSenses ?? 0;
      merged.senses.splice(at, 0, ...ex.senses);
      merged.leadSenses = at + ex.senses.length;
      if (ex.ipa) merged.ipa = ex.ipa;
      leadsMatched.add(ex.word);
    } else {
      merged.senses.push(...ex.senses);
    }
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
      // A headword alias outranks an alternative-form row for the same surface
      // string, so when both exist the alternative rows go.
      //
      // A headword alias says "this string IS the Traditional headword of that
      // entry", which is the strongest claim there is. An `alternative` row only
      // says some other entry can also be spelled this way, usually in an
      // archaic sense. Both used to land in the table and the lookup resolved
      // whichever was inserted first, so 這 answered `chī` (from 媸, which lists
      // 這 as an alternative spelling) rather than `zhè`. 864 surface forms were
      // resolving to an alternative this way.
      //
      // Only the rows that LOSE a contest are dropped. An alternative row with
      // no competing headword alias is the only path 15,864 surface forms have,
      // so dropping those wholesale would cost far more than it fixed.
      const refs = [...bucket];
      const hasHeadword = refs.some((ref) => ref.endsWith('::headword'));
      for (const ref of refs) {
        const sep = ref.indexOf('::');
        const lemma = ref.slice(0, sep);
        const type = ref.slice(sep + 2);
        if (hasHeadword && type !== 'headword' && type.includes('alternative')) continue;
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
    // ar folds its keys past the case fold (tashkeel, tatweel, alef), so the
    // corpus word has to travel the same road or the gate would measure a
    // spelling the database never stored.
    const cased = lowerForLang(w);
    const lower = PROFILE.foldArabicKeys ? foldArabicKey(cased) : cased;

    const hit = exact.get(lower) as { word: string } | undefined;
    if (hit) return hit;

    // Mirror of dictionary-db.ts step 1b: the tokenizer drops a trailing
    // apostrophe (po'), so retry the keyed form.
    if (!lower.endsWith("'")) {
      const clipped = exact.get(`${lower}'`) as { word: string } | undefined;
      if (clipped) return clipped;
    }

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

    // Mirror of the runtime loose-Arabic fallback (dictionary-db.ts step 3-ar):
    // retry with the ة→ه, ى→ي key against the alias rows.
    if (PROFILE.looseAliases === 'arabic') {
      const loose = arabicLooseKey(lower);
      if (loose !== lower) {
        const looseHit = exact.get(loose) as { word: string } | undefined;
        if (looseHit) return looseHit;
        const looseInfl = byInflection.get(loose) as { lemma: string } | undefined;
        if (looseInfl) {
          const lemma = exact.get(looseInfl.lemma) as { word: string } | undefined;
          if (lemma) return lemma;
        }
      }
    }

    // Mirror of the runtime morphology step (dictionary-db.ts step 5-morph), so
    // the gate measures what the live lookup resolves. ko and id declare a
    // `morphology` slice.
    if (MORPHOLOGY) {
      for (const candidate of stemCandidates(lower, MORPHOLOGY)) {
        const keyHit = exact.get(candidate.key) as { word: string } | undefined;
        if (keyHit) return keyHit;
        const keyInfl = byInflection.get(candidate.key) as { lemma: string } | undefined;
        if (keyInfl) {
          const lemma = exact.get(keyInfl.lemma) as { word: string } | undefined;
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
            for (const tok of tokenize(row.t)) corpus.add(lowerForLang(tok));
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

/**
 * Check the readings named in `readingInvariants` against the built database.
 *
 * Reads it the way the reader does: the entry first, then the headword aliases
 * in `inflections`. A word the reader cannot resolve counts as a failure, so a
 * key that goes missing is caught as well as one that answers wrongly.
 */
function checkReadingInvariants(): string[] {
  const expected = PROFILE.readingInvariants;
  if (!expected) return [];
  const db = new Database(DB_PATH, { readonly: true });
  const selectDirect = db.prepare('SELECT ipa FROM entries WHERE word = ?');
  const selectAlias = db.prepare(
    `SELECT e.ipa AS ipa FROM inflections i
       JOIN entries e ON e.word = i.lemma
      WHERE i.inflected_form = ?
      ORDER BY (e.rank IS NULL), e.rank, i.rowid LIMIT 1`,
  );
  const failures: string[] = [];
  for (const [word, want] of Object.entries(expected)) {
    const direct = selectDirect.get(word) as { ipa: string | null } | undefined;
    const alias = direct?.ipa
      ? null
      : (selectAlias.get(word) as { ipa: string | null } | undefined);
    const got = direct?.ipa ?? alias?.ipa ?? null;
    if (got !== want) failures.push(`${word}: expected ${want}, got ${got ?? 'no reading'}`);
  }
  db.close();
  return failures;
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
      corpus.add(lowerForLang(w));
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

  if (PROFILE.looseAliases === 'arabic') {
    // The ar sibling of markStrippedAliases (#253). Register arabicLooseKey of
    // every key as an extra inflection row, type 'unpointed', so the runtime
    // fallback has something to hit when a text spells مدرسه for مدرسة or علي
    // for على. Exact keys always win first, so a real minimal pair keeps its
    // own entry and this only answers a word nothing else resolved.
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
      const loose = arabicLooseKey(word);
      if (loose === word || !loose) continue;
      addAlias(loose, `${word}::unpointed`);
      aliased++;
    }
    for (const [inflected, bucket] of [...inflectionMap]) {
      const loose = arabicLooseKey(inflected);
      if (loose === inflected || !loose) continue;
      for (const ref of bucket) addAlias(loose, ref);
      aliased++;
    }
    console.log(`  loose Arabic aliases (${LANG}): ${aliased} keys registered`);
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

  // A lead form that matches nothing is a map written against an older dump,
  // and it fails SILENTLY: the key keeps whatever the dump leads with, which is
  // the wrong answer the map existed to fix.
  if (LEAD_FORMS) {
    const stale = Object.keys(LEAD_FORMS).filter((key) => !leadsMatched.has(key));
    if (stale.length > 0) {
      console.error('\nLead forms that matched no record:');
      for (const key of stale) console.error(`  - ${key} -> ${LEAD_FORMS[key]}`);
      process.exit(1);
    }
    console.log(`  lead forms: ${leadsMatched.size}/${Object.keys(LEAD_FORMS).length} matched`);
  }

  // Before coverage, because a wrong reading is worse than a thin one. A
  // learner can live with a word the dictionary does not know. A word it
  // answers confidently and wrongly teaches them the wrong thing.
  const readingFailures = checkReadingInvariants();
  if (readingFailures.length > 0) {
    console.error('\nReading invariants failed:');
    for (const f of readingFailures) console.error('  -', f);
    process.exit(1);
  }
  if (PROFILE.readingInvariants) {
    const n = Object.keys(PROFILE.readingInvariants).length;
    console.log(`  reading invariants: ${n}/${n} correct`);
  }

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

  const threshold = PROFILE.coverageThreshold ?? COVERAGE_THRESHOLD;
  if (threshold !== COVERAGE_THRESHOLD) {
    console.log(
      `  (${LANG} builds against a reduced ${(threshold * 100).toFixed(0)}% gate — see coverageThreshold)`,
    );
  }

  if (pct < threshold) {
    console.error(`\nCoverage below ${(threshold * 100).toFixed(0)}% threshold. First 50 misses:`);
    for (const m of misses) console.error('  -', m);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
