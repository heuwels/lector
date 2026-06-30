// Shared language-registry types — the single source of truth for per-language
// config, imported by BOTH the Next client (src/) and the Hono API (api/) and
// shipped into the API image (see the Dockerfile `COPY languages` step).
//
// Adding a language = drop a `languages/<code>/manifest.ts` and register it in
// `languages/registry.ts`. Nothing else in this layer changes.

import type { LanguageCode } from './registry';

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
}
