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

/** Server-side TTS engines a language can be spoken by (#307 §3.2). */
export type TtsEngine = 'google' | 'espeak';

/**
 * Pronunciation capability (#307 §3.2) — two orthogonal axes, because a
 * language can have BOTH a synthesized voice and a phonetic gloss (Esperanto:
 * eSpeak audio + rule-generated IPA), which a single mode union can't express.
 */
export interface PronunciationConfig {
  /**
   * Server TTS engines that can speak this language, ordered best-first — or
   * 'none' for languages where synthesized audio is wrong *on principle*
   * (disputed/reconstructed pronunciation: Koine Greek, Latin, Biblical
   * Hebrew…). On 'none' the speaker UI absents itself rather than silently
   * mis-speaking via a wrong-language browser voice. Browser TTS remains a
   * client-side concern layered on top ('google' languages only).
   */
  audio: readonly TtsEngine[] | 'none';
  /**
   * Rule-rendered phonetic gloss. 'ipa' = IPA is derivable from spelling by
   * rule (Esperanto: one-phoneme-per-letter + fixed penultimate stress), so
   * lookups can attach a pronunciation without TTS, dictionary data, or a
   * model.
   */
  gloss?: 'ipa';
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
  /** Primary TTS locale, e.g. "de-DE". Required when 'google' ∈ pronunciation.audio. */
  ttsCode?: string;
  /** Preferred Google Cloud TTS voice. Required when 'google' ∈ pronunciation.audio. */
  ttsVoice?: string;
  /** Tatoeba 3-letter code, e.g. "deu". */
  tatoebaCode: string;
  /** Browser-TTS fallback locales, most-specific first. Only meaningful for 'google' languages. */
  fallbackTts?: string[];
  /** Cloze stop-words — function words never worth blanking. */
  avoidWords: Set<string>;
  /** Sample sentence for voice/settings previews. */
  testPhrase: string;
  /** Which engines (if any) may speak this language + optional phonetic gloss (#307 §3.2). */
  pronunciation: PronunciationConfig;
  /** Script behavior — tokenization, folding, direction (#289). */
  script: ScriptConfig;
}
