// Which registry languages a learner opted into (#442). Shared by BOTH the Next
// client (the picker) and the Hono API (the `enabledLanguages` setting), so one
// normalizer decides the order and the membership everywhere.

import { isValidLanguageCode, LANGUAGES, type LanguageCode } from './registry';

const REGISTRY_ORDER = Object.keys(LANGUAGES) as LanguageCode[];

/**
 * The opted-in set as a clean list: unknown codes dropped, duplicates removed,
 * registry order restored. Unknown codes are dropped rather than rejected — a
 * stored list survives a pack that a later release removes.
 */
export function normalizeEnabledLanguages(codes: readonly unknown[]): LanguageCode[] {
  const wanted = new Set(
    codes.filter(
      (code): code is LanguageCode => typeof code === 'string' && isValidLanguageCode(code),
    ),
  );
  return REGISTRY_ORDER.filter((code) => wanted.has(code));
}

/** The opted-in set with `code` added. */
export function withLanguageEnabled(codes: readonly unknown[], code: LanguageCode): LanguageCode[] {
  return normalizeEnabledLanguages([...codes, code]);
}

/** The opted-in set with `code` removed. */
export function withLanguageDisabled(
  codes: readonly unknown[],
  code: LanguageCode,
): LanguageCode[] {
  return normalizeEnabledLanguages(codes).filter((entry) => entry !== code);
}

/** The registry languages that are not in the opted-in set, in registry order. */
export function availableLanguages(codes: readonly unknown[]): LanguageCode[] {
  const enabled = new Set(normalizeEnabledLanguages(codes));
  return REGISTRY_ORDER.filter((code) => !enabled.has(code));
}
