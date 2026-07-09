// Shared language-registry types — the single source of truth for per-language
// config, imported by BOTH the Next client (src/) and the Hono API (api/) and
// shipped into the API image (see the Dockerfile `COPY languages` step).
//
// Adding a language = drop a `languages/<code>/manifest.ts` and register it in
// `languages/registry.ts`. Nothing else in this layer changes.

import type { LanguageCode } from './registry';

/**
 * How a language's script behaves in the reader/text model (#289).
 * This is the seam the multi-script languages (ru, grc, ko, zh, ja, ar, hbo)
 * plug into: tokenization, folding, sentence splitting, direction and fonts
 * all dispatch on this slice instead of hardcoded Latin assumptions.
 */
export interface ScriptConfig {
  /** BCP 47 tag, e.g. 'de', 'zh-Hans', 'ar' — feeds lang= attributes and Intl.* APIs. */
  bcp47: string;
  /** Reading direction of the script. */
  direction: 'ltr' | 'rtl';
  /**
   * Tokenizer dispatch class:
   * - 'alpha-spaced': whitespace-separated alphabetic scripts (Latin, Cyrillic,
   *   Greek, Arabic, Hebrew) — one Unicode-property engine covers all of them.
   * - 'hangul': spaced Korean (eojeol tokens; same engine, keep-all wrapping).
   * - 'cjk-unspaced': zh/ja — segmentation engine lands in Phase 4 of #289.
   */
  kind: 'alpha-spaced' | 'hangul' | 'cjk-unspaced';
  /** False for scripts with no letter case (ar, hbo, zh, ja, ko) — foldWord skips lowercasing. */
  hasCase: boolean;
  /** Sentence-ending characters; defaults to '.!?'. zh/ja '。．！？!?', ar '؟.!', grc '.;·'. */
  sentenceTerminators?: string;
  /** Extra characters allowed INSIDE a word beyond letters/marks (e.g. grc elision marks). */
  extraWordChars?: string;
  /**
   * Regex-source alternatives matched as whole tokens BEFORE the engine's word
   * pattern — pack-level token forms the generic engine can't express (af: the
   * <apostrophe>n article). Compiled with 'giu' flags.
   */
  extraTokenPatterns?: string[];
  /** Phase 3 (#289): 'fold-marks' accepts mark-stripped practice answers. Defaults to 'exact'. */
  practiceLeniency?: 'exact' | 'fold-marks';
  /** Phase 1 (#289): per-script reading font class resolved in the reader. */
  fontClass?: string;
}

export interface LanguageConfig {
  /** English name, e.g. "German". */
  name: string;
  /** Endonym, e.g. "Deutsch". */
  native: string;
  /** Short code; equals this entry's key in LANGUAGES (e.g. "de"). */
  code: LanguageCode;
  /** Flag emoji. */
  flag: string;
  /** Primary TTS locale, e.g. "de-DE". */
  ttsCode: string;
  /** Preferred Google Cloud TTS voice. */
  ttsVoice: string;
  /** Tatoeba 3-letter code, e.g. "deu". */
  tatoebaCode: string;
  /** Browser-TTS fallback locales, most-specific first. */
  fallbackTts: string[];
  /** Cloze stop-words — function words never worth blanking. */
  avoidWords: Set<string>;
  /** Sample sentence for voice/settings previews. */
  testPhrase: string;
  /** Script behavior — tokenization, folding, direction (#289). */
  script: ScriptConfig;
}
