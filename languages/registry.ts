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
import { ar } from './ar/manifest';
import { bn } from './bn/manifest';
import { cs } from './cs/manifest';
import { de } from './de/manifest';
import { eo } from './eo/manifest';
import { es } from './es/manifest';
import { fr } from './fr/manifest';
import { grc } from './grc/manifest';
import { hi } from './hi/manifest';
import { id } from './id/manifest';
import { it } from './it/manifest';
import { ja } from './ja/manifest';
import { ko } from './ko/manifest';
import { la } from './la/manifest';
import { nl } from './nl/manifest';
import { pl } from './pl/manifest';
import { pt } from './pt/manifest';
import { ru } from './ru/manifest';
import { sv } from './sv/manifest';
import { tr } from './tr/manifest';
import { uk } from './uk/manifest';
import { zh } from './zh/manifest';

export type { LanguageConfig, ProseDefaults } from './types';

// Keys-only object: `LanguageCode` is derived from these without referencing
// `LanguageConfig`, which keeps types.ts ⇄ registry.ts free of a type cycle.
const MANIFESTS = {
  af,
  ar,
  bn,
  cs,
  de,
  eo,
  es,
  fr,
  grc,
  hi,
  id,
  it,
  ja,
  ko,
  la,
  nl,
  pl,
  pt,
  ru,
  sv,
  tr,
  uk,
  zh,
};

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
