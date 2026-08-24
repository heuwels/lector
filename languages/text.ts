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
  return pack.code === 'la' ? foldLatinKey(cased) : cased;
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
 */
export function foldForComparison(text: string, pack: LanguageConfig): string {
  return pack.script.practiceLeniency === 'fold-marks' ? stripMarks(text) : text;
}
