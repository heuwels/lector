// Text normalization and word-key folding (#289 Phase 0).
// Shared by the Next client (src/) and the Hono API (api/) — the client
// re-exports via src/lib/languages.ts, the API via api/src/lib/languages.ts.

import type { LanguageConfig } from './types';

// Invisible characters that break tokenization and word matching but carry no
// meaning in stored text: BOM/zero-width no-break space, zero-width space,
// word joiner, and soft hyphen (EPUBs love soft hyphens — they split words
// mid-token and poison vocab keys). Deliberately NOT stripped: ZWJ/ZWNJ
// (orthographic in Arabic-script and Indic languages) and LRM/RLM directional
// marks (meaningful for bidi display, Phase 2 of #289).
const INVISIBLE_CHARS = /[\u00AD\u200B\u2060\uFEFF]/g;

/**
 * Canonicalize text at every ingress (EPUB import, paste/edit, typed practice
 * input, vocab writes, dictionary build): Unicode NFC plus invisible-character
 * stripping. Decomposed input (macOS pastes, some EPUB sources) otherwise
 * silently breaks word matching — for Korean NFD it's fatal (jamo vs
 * syllables); for polytonic Greek NFC also folds the oxia/tonos duplicates
 * (U+1F71 → U+03AC).
 */
export function normalizeText(text: string): string {
  return text.replace(INVISIBLE_CHARS, '').normalize('NFC');
}

/**
 * Fold a word to its canonical vocab/dictionary key. Every place a word
 * becomes a key (knownWords, vocab lookups, dictionary cache, phrase
 * matching) must go through this — never raw `toLowerCase()`, and never
 * SQLite's `LOWER()` (ASCII-only: it disagrees with JS for ä/é/Cyrillic/Greek,
 * so keys would drift between the app and the DB).
 *
 * v0 (Phase 0 of #289): NFC + lowercase for cased scripts — byte-identical to
 * the old `toLowerCase()` keying for shipped languages on NFC input. Phase 3
 * extends this with per-pack mark folding (tashkeel/niqqud stripping, final
 * forms, ς→σ).
 *
 * Packs that set `script.caseFoldLocale` fold under that locale instead (tr:
 * dotted/dotless i). Re-normalize after a locale fold, because Turkish `İ`
 * lowercases through a decomposed intermediate.
 */
export function foldWord(text: string, pack: LanguageConfig): string {
  const normalized = foldApostrophesFor(normalizeText(text), pack);
  const cased = pack.script.hasCase ? lowerForPack(normalized, pack) : normalized;
  if (pack.code === 'la') return foldLatinKey(cased);
  if (pack.code === 'ar') return foldArabicKey(cased);
  if (pack.code === 'hbo') return foldHebrewKey(cased);
  return cased;
}

const LATIN_MACRON_BREVE = /[\u0304\u0306]/g;

/**
 * Latin vocab key (#256): drop editorial vowel-length marks and unfold
 * ligatures. Dictionaries print ā ē ī ō ū and æ/œ. Running text almost
 * never does, so amāre and amare must be one key.
 */
export function foldLatinKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(LATIN_MACRON_BREVE, '')
    .normalize('NFC')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe');
}

/**
 * Edition variants for a Latin lookup. Texts mix u/v and i/j (uult/vult,
 * iam/jam). Try the swapped spellings only after the exact key misses.
 */
export function latinLookupVariants(key: string): string[] {
  const variants = new Set<string>();
  const uv = key.replace(/u/g, 'v');
  const vu = key.replace(/v/g, 'u');
  const ij = key.replace(/i/g, 'j');
  const ji = key.replace(/j/g, 'i');
  for (const form of [uv, vu, ij, ji, uv.replace(/i/g, 'j'), vu.replace(/i/g, 'j')]) {
    if (form !== key) variants.add(form);
  }
  return [...variants];
}

// Arabic short-vowel and gemination marks (tashkeel), the superscript alef,
// and the Quranic annotation marks. Every one of them is a NONSPACING mark that
// unvocalized prose simply omits, so a key that keeps them can never be hit:
// kaikki writes كَتَبَ and a newspaper writes كتب.
const ARABIC_MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;

// Tatweel (kashida) is a justification glyph, not a letter: مــدرسة is مدرسة
// stretched to fill a line. It is \p{Lm}, so the tokenizer keeps it inside the
// token and the fold has to remove it.
const ARABIC_TATWEEL = /\u0640/g;

// The four alef spellings that carry a hamza or a wasla. Real text writes the
// hamza inconsistently — wordfreq's Arabic list holds both أن and ان in its top
// thirty tokens, one word under two spellings — so the key folds them to bare
// alef. Standard practice for Arabic retrieval, and the same normalization the
// dump's own headwords need.
const ARABIC_ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/g;

/**
 * Arabic vocab key (#253): drop the diacritics running text omits, drop the
 * tatweel, and fold the alef spellings.
 *
 * Nothing folds the hamza on waw or ya (ؤ, ئ). Those two are precomposed
 * single code points that NFC never takes apart, and they are written
 * consistently, so folding them would only merge unrelated keys.
 *
 * Two spellings this deliberately leaves alone are handled one step later, as
 * lookup aliases rather than as keys: see arabicLooseKey.
 */
export function foldArabicKey(text: string): string {
  return text
    .replace(ARABIC_MARKS, '')
    .replace(ARABIC_TATWEEL, '')
    .replace(ARABIC_ALEF_VARIANTS, '\u0627');
}

/**
 * The lenient Arabic key, for the last-resort lookup and for the alias rows the
 * dictionary build registers alongside every entry (#253).
 *
 * Two letter pairs are confused in real text and never in a dictionary:
 *
 * - Ta marbuta ة against ha ه. مدرسة is routinely typed مدرسه.
 * - Alef maqsura ى against ya ي. على is routinely typed علي, and في is typed فى.
 *
 * Folding both in the KEY would be wrong: في (in) and فى are one word, but the
 * fold also merges genuine pairs, and a dictionary that answers the wrong
 * headword is worse than one that answers nothing. So the exact key wins first
 * and this runs only after it misses. Applied to both sides of the comparison,
 * which is why the build stores the folded form as an alias.
 */
export function arabicLooseKey(key: string): string {
  return key.replace(/\u0629/g, '\u0647').replace(/\u0649/g, '\u064A');
}

// Cantillation (te'amim, U+0591–U+05AF) and niqqud (U+05B0–U+05BD, U+05BF,
// U+05C1–U+05C2, U+05C4–U+05C5, U+05C7). Maqaf (U+05BE), paseq (U+05C0) and
// sof pasuq (U+05C3) stay: they are punctuation, not vowel marks. hbo joins
// on maqaf, so the mark must remain on the key for lookup to split it.
const HEBREW_MARKS = /[\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7]/g;

/**
 * Biblical Hebrew vocab key (#255): drop cantillation and niqqud.
 *
 * A verse prints בְּרֵאשִׁית and the dictionary keys בראשית. Final letter
 * forms stay on the key. They fold only at lookup, via hebrewLooseKey, so a
 * genuine headword keeps the final kaf a reader expects.
 *
 * Maqaf stays on a joined token (גם־שניהם) so lookup can split the parts.
 */
export function foldHebrewKey(text: string): string {
  return text.replace(HEBREW_MARKS, '');
}

const HEBREW_FINAL_FORMS: Record<string, string> = {
  ך: 'כ',
  ם: 'מ',
  ן: 'נ',
  ף: 'פ',
  ץ: 'צ',
};

/**
 * The lenient Biblical Hebrew key (#255). Final ך ם ן ף ץ fold onto their
 * medial pairs. Exact keys win first, so מלך keeps its own entry and מלכ
 * reaches it only after that miss.
 */
export function hebrewLooseKey(key: string): string {
  return key.replace(/[ךםןףץ]/g, (letter) => HEBREW_FINAL_FORMS[letter] ?? letter);
}

/** Every apostrophe variant a keyboard, an editor or an EPUB can produce. */
const APOSTROPHE_VARIANTS = /[‘’ʼʹ`´]/g;

/**
 * Map apostrophe variants to ASCII ' for packs that spell words with one
 * (uk: п'ять, it: l'italiano). Running text carries whichever variant its
 * source used — straight from a keyboard, curly from a word processor,
 * U+02BC from a standards-minded typesetter — and all three must key to the
 * one dictionary headword. A no-op for every pack that leaves
 * `foldApostrophes` unset, so fr/nl keys stay byte-stable.
 */
export function foldApostrophesFor(text: string, pack: LanguageConfig): string {
  if (!pack.script.foldApostrophes) return text;
  return text.replace(APOSTROPHE_VARIANTS, "'");
}

/**
 * Lowercase under the pack's fold locale when it declares one (tr), and under
 * the default Unicode mapping otherwise. Use this anywhere a comparison
 * lowercases target-language text but can't use the full `foldWord` — the
 * practice answer check, which also strips punctuation. Without a pack it is
 * plain `toLowerCase()`, so language-blind call sites keep their behavior.
 */
export function lowerForPack(text: string, pack?: LanguageConfig): string {
  const locale = pack?.script.caseFoldLocale;
  return locale ? text.toLocaleLowerCase(locale).normalize('NFC') : text.toLowerCase();
}

/**
 * Strip combining marks for lenient comparison (#289 Phase 3): decompose,
 * drop every \p{M}, recompose, and fold the Greek final sigma. For polytonic
 * Greek this folds breathings, accents (including the grave that replaces a
 * word-final acute in running text) and iota subscripts — λόγος ≡ λογος,
 * τὸν ≡ τόν, ᾧ ≡ ω. Pure mark-stripping: never applied to stored text, only
 * to both sides of a comparison or a last-resort lookup.
 */
export function stripMarks(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').replace(/ς/g, 'σ');
}

/**
 * Fold for practice-answer comparison: exact for most packs; packs that opt
 * into `practiceLeniency: 'fold-marks'` (grc — polytonic input needs a
 * specialist keyboard) accept mark-stripped matches.
 *
 * WHICH marks is a per-script question, so this dispatches the same way
 * `foldWord` does. `stripMarks` is the Greek answer, not a universal one: it
 * decomposes and drops every \p{M}, and for Arabic that rewrites the hamza
 * carriers. ؤ becomes و and ئ becomes ي, which makes رؤية ("seeing") and روية
 * ("deliberation") compare EQUAL. 51 such pairs exist in the shipped Arabic
 * dictionary, and grading them as one accepts a learner's wrong word (#253).
 *
 * So ar folds with `foldArabicKey`, which drops the tashkeel and the tatweel
 * and folds the alef, and leaves ؤ and ئ alone. That also makes the answer
 * check agree with the dictionary key, which is the same fold.
 *
 * A pack that adds `fold-marks` for a NEW script must decide its own mark set
 * here. Inheriting the Greek one is what this comment exists to prevent.
 */
export function foldForComparison(text: string, pack: LanguageConfig): string {
  if (pack.script.practiceLeniency !== 'fold-marks') return text;
  if (pack.code === 'ar') return foldArabicKey(text);
  if (pack.code === 'hbo') return hebrewLooseKey(foldHebrewKey(text));
  return stripMarks(text);
}
