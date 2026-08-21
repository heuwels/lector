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
   * - 'cjk-unspaced': zh/ja — segmented by Intl.Segmenter word granularity
   *   (#289 Phase 4). Sentence splitting does not require whitespace after the
   *   terminator here, so set `sentenceTerminators` to the fullwidth set.
   */
  kind: 'alpha-spaced' | 'hangul' | 'cjk-unspaced';
  /** False for scripts with no letter case (ar, hbo, zh, ja, ko) — foldWord skips lowercasing. */
  hasCase: boolean;
  /**
   * Locale tag for case folding, when the default Unicode lowercasing is wrong
   * for the language. Only Turkic packs need it: tr/az write the dotted and
   * dotless i as separate letters, so `I` must fold to `ı` and `İ` to `i`,
   * where the default rules give `i` and `i` + U+0307. Omit for every other
   * pack — locale-insensitive folding keeps their keys byte-stable.
   */
  caseFoldLocale?: string;
  /** Sentence-ending characters; defaults to '.!?'. zh/ja '。．！？!?', ar '؟.!', grc '.;·'. */
  sentenceTerminators?: string;
  /** Extra characters allowed INSIDE a word beyond letters/marks (e.g. grc elision marks). */
  extraWordChars?: string;
  /**
   * Extra characters that JOIN two letter runs into one token, on top of the
   * built-in hyphens. A joiner differs from `extraWordChars`: it only counts
   * between two runs, never at a token edge, so it cannot swallow a quote mark.
   * Ukrainian needs it for the apostrophe, which is a letter-level part of the
   * word (п'ять, м'ясо, з'їзд) and not the elision mark it is in fr/it/nl —
   * those packs deliberately split on it and must not set this.
   */
  extraJoiners?: string;
  /**
   * Fold every apostrophe variant (’ ʼ ‘ `) to ASCII ' in word keys. Set it
   * with `extraJoiners` whenever the apostrophe is part of the spelling: text
   * in the wild carries whichever variant an editor produced, but a key must
   * be one spelling, and kaikki writes Ukrainian headwords with ASCII '.
   */
  foldApostrophes?: boolean;
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
  /**
   * Source of the per-word reading the reader prints ABOVE each word, as HTML
   * ruby (#289 4.4). Absent means the language gets no annotations.
   *
   * 'dictionary' reads `entries.ipa` from the on-device dictionary. zh stores
   * pinyin there (see `pronunciationSoundTags` in its build profile), which is
   * what a learner actually reads.
   *
   * 'analyser' asks a morphological analyser instead, per lesson, so the reading
   * follows the CONTEXT. Japanese needs that and Chinese does not. A dictionary
   * holds one reading per headword, and Japanese kanji do not work that way: 本
   * reads ほん in 本を読む and もと in 本を正す. A dictionary also has no headword
   * for an inflected form, so 読ん gets nothing at all. The analyser answers both
   * from the sentence it sits in. See api/src/lib/ja-morphology.ts.
   *
   * Deliberately opt-IN per pack, and today zh only. Two reasons to keep it
   * narrow:
   *
   * - Most packs store true IPA sparsely. af fills 2,213 of 15,686 entries, so
   *   the layer would annotate one word in seven and read as a fault.
   * - A phonemic script does not need it. Esperanto spelling already gives the
   *   pronunciation letter for letter, so `ˈdomo` above `domo` is noise. The
   *   layer earns its place where the script HIDES the reading: Han characters,
   *   and Japanese kanji when that pack lands.
   */
  annotation?: 'dictionary' | 'analyser';
  /**
   * Regex source. A word annotated ONLY when it matches. Absent means annotate
   * every word that has a reading.
   *
   * Japanese needs it and Chinese does not. An annotation exists to reveal a
   * reading the script hides, and kana hides nothing: を reads "o" and です
   * reads "desu", exactly as written. Worse, several single kana are also
   * archaic kanji-words in the dictionary, so looking one up returns an
   * unrelated reading. Measured on a first-lesson text, を came back as あく,
   * へ as ほう and ます as もうす. Printing that above a particle teaches an
   * error.
   *
   * So ja matches Han only, and a word with no kanji gets nothing. Every
   * Chinese word is Han, so zh leaves this unset and annotates all of them.
   */
  annotationRequires?: string;
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
