// The shared language registry — single source of truth for both the Next client
// (src/) and the Hono API (api/). The old `src/lib/languages.ts` and
// `api/src/lib/languages.ts` are now thin re-exports of this file, so there is no
// hand-kept mirror to drift.
//
// ── To add a language ──────────────────────────────────────────────────────
//   1. Create `languages/<code>/manifest.ts` (copy an existing one).
//   2. Import it and add it to MANIFESTS below.
// `LanguageCode` widens automatically from the keys; every consumer that reads
// the registry (picker, TTS, Tatoeba, cloze seeding, …) picks it up for free. A
// malformed manifest is reported against the LANGUAGES assignment below.

import type { LanguageConfig } from './types';
import { af } from './af/manifest';
import { de } from './de/manifest';
import { es } from './es/manifest';
import { fr } from './fr/manifest';

export type { LanguageConfig } from './types';

// Keys-only object: `LanguageCode` is derived from these without referencing
// `LanguageConfig`, which keeps types.ts ⇄ registry.ts free of a type cycle.
const MANIFESTS = { af, de, es, fr };

/** Derived from the registry keys — never hand-written. */
export type LanguageCode = keyof typeof MANIFESTS;

// Annotated assignment doubles as the per-manifest conformance check.
export const LANGUAGES: Record<LanguageCode, LanguageConfig> = MANIFESTS;

export const DEFAULT_LANGUAGE: LanguageCode = 'af';

export function getLanguageConfig(code: LanguageCode): LanguageConfig {
  return LANGUAGES[code];
}

export function isValidLanguageCode(code: string): code is LanguageCode {
  return code in LANGUAGES;
}

export function getAllLanguages(): LanguageConfig[] {
  return Object.values(LANGUAGES);
}
