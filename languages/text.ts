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
 */
export function foldWord(text: string, pack: LanguageConfig): string {
  const normalized = normalizeText(text);
  return pack.script.hasCase ? normalized.toLowerCase() : normalized;
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
