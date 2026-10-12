/**
 * Single source of truth for the settings-table key policy (#233).
 *
 * SENSITIVE_KEYS are credentials: the settings GET routes mask them as `true`,
 * and the learning-data takeout (`GET /api/data`) omits them entirely. The
 * REDACTION_SENTINEL remains part of restore compatibility for older backups
 * that represented a secret setting without carrying its live value.
 *
 * KNOWN_SETTING_KEYS is every key the app actually writes (settings UI, setup,
 * CLI, boot migrations in db.ts). Settings writes reject anything else — an
 * arbitrary key/value store whose values feed fetch targets and Bearer headers
 * is a footgun otherwise.
 *
 * URL_SETTING_KEYS must parse as http(s): their values become request targets
 * that receive stored credentials (llm/index.ts sends openaiApiKey as a
 * `Authorization: Bearer` header to openaiUrl), so a poisoned URL exfiltrates
 * the key on the next LLM call.
 */
import { isValidLanguageCode, LANGUAGES } from './languages';

export const SENSITIVE_KEYS = new Set([
  'anthropicApiKey',
  'claudeOauthToken',
  'lmstudioApiKey',
  'openaiApiKey',
]);

export const REDACTION_SENTINEL = '__REDACTED__';
export const MAX_SETTING_VALUE_BYTES = 64 * 1024;

/**
 * Per-key value ceilings for keys whose shape bounds them far below
 * MAX_SETTING_VALUE_BYTES. The free-tier restore witness
 * (lib/free-takeout-budget.ts) charges the envelope one ceiling per known key,
 * so a key that can only ever hold a few bytes must say so.
 */
const SETTING_VALUE_BYTE_LIMITS: Record<string, number> = {
  // A list of registry codes with no repeats, so the whole registry is the most
  // it can hold.
  enabledLanguages: Buffer.byteLength(JSON.stringify(Object.keys(LANGUAGES)), 'utf8'),
  // Highlighting settings — small JSON values (numbers, strings, simple objects)
  highlightPadding: 32,
  highlightTransparency: 32,
  highlightBorderRadius: 32,
  highlightColor: 32,
  phraseBorderStyle: 32,
  // Persistence settings
  persistHighlights: 16,
  autoRestoreHighlights: 16,
};

export function settingValueByteLimit(key: string): number {
  return SETTING_VALUE_BYTE_LIMITS[key] ?? MAX_SETTING_VALUE_BYTES;
}

export const URL_SETTING_KEYS = new Set(['openaiUrl', 'ankiConnectUrl', 'apfelUrl', 'lmstudioUrl']);

export const KNOWN_SETTING_KEYS = new Set([
  // Core
  'targetLanguage',
  'enabledLanguages',
  'timezone',
  // Highlighting configuration (Settings → Appearance → Reading Mode)
  'highlightPadding',
  'highlightTransparency',
  'highlightBorderRadius',
  'highlightColor',
  'phraseBorderStyle',
  // Highlighting persistence
  'persistHighlights',
  'autoRestoreHighlights',
  // LLM provider config (Settings → AI, setup)
  'llmProvider',
  'openaiPreset',
  'openaiUrl',
  'openaiModel',
  'openaiApiKey',
  'anthropicApiKey',
  'claudeOauthToken',
  'anthropicAuthMode',
  // Anki
  'ankiConnectUrl',
  // Anki transport (#241): 'ankiconnect' (browser→localhost, the selfhost
  // default) or 'addon' (server-side queue + Lector Sync addon — forced in
  // cloud, opt-in for self-hosters whose Lector is HTTPS/remote).
  'ankiTransport',
  // Legacy provider keys — no longer written by the UI, but db.ts boot
  // migrations still read them and older DBs/CLI flows may round-trip them.
  'ollamaModel',
  'apfelUrl',
  'apfelModel',
  'lmstudioUrl',
  'lmstudioModel',
  'lmstudioApiKey',
]);

/**
 * Validate one settings write. Returns an error message, or null when the
 * write is acceptable. An empty string is allowed for URL keys — it means
 * "unset the endpoint" (the settings UI writes '' to clear a field).
 */
const ANKI_TRANSPORTS = new Set(['ankiconnect', 'addon']);

export function validateSettingWrite(key: string, value: unknown): string | null {
  if (!KNOWN_SETTING_KEYS.has(key)) return `Unknown setting key: ${key}`;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return `${key} must be JSON-serializable`;
  }
  if (serialized === undefined) return `${key} must be JSON-serializable`;
  const byteLimit = settingValueByteLimit(key);
  if (Buffer.byteLength(serialized, 'utf8') > byteLimit) {
    return `${key} exceeds the ${byteLimit}-byte setting limit`;
  }
  if (key === 'targetLanguage' && (typeof value !== 'string' || !isValidLanguageCode(value))) {
    return 'targetLanguage must be a supported language';
  }
  if (key === 'enabledLanguages') {
    if (!Array.isArray(value)) return 'enabledLanguages must be an array of language codes';
    if (value.length === 0) return 'enabledLanguages must list at least one language';
    if (value.some((code) => typeof code !== 'string' || !isValidLanguageCode(code))) {
      return 'enabledLanguages must list supported languages only';
    }
    // No repeats: the byte ceiling above is the registry, and a repeated code
    // would let the value grow past it.
    if (new Set(value).size !== value.length) {
      return 'enabledLanguages must not repeat a language';
    }
  }
  if (key === 'ankiTransport' && value !== '' && value !== null) {
    if (typeof value !== 'string' || !ANKI_TRANSPORTS.has(value)) {
      return "ankiTransport must be 'ankiconnect' or 'addon'";
    }
  }
  if (key === 'highlightPadding') {
    if (typeof value !== 'number' || value < 1 || value > 20) {
      return 'highlightPadding must be a number between 1 and 20';
    }
  }
  if (key === 'highlightTransparency') {
    if (typeof value !== 'number' || value < 0.1 || value > 1) {
      return 'highlightTransparency must be a number between 0.1 and 1';
    }
  }
  if (key === 'highlightBorderRadius') {
    if (typeof value !== 'number' || value < 0 || value > 999) {
      return 'highlightBorderRadius must be a number between 0 and 999';
    }
  }
  if (key === 'highlightColor') {
    if (typeof value !== 'string') return 'highlightColor must be a string';
    // Allow any valid CSS color value
    const colorRegex = /^(#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})|rgb\s*\([^)]+\)|rgba\s*\([^)]+\)|hsl\s*\([^)]+\)|hsla\s*\([^)]+\)|currentColor|var\([^)]+\))$/;
    if (!colorRegex.test(value)) {
      return 'highlightColor must be a valid CSS color';
    }
  }
  if (key === 'phraseBorderStyle') {
    if (typeof value !== 'string') return 'phraseBorderStyle must be a string';
    const validStyles = ['solid', 'double', 'dashed', 'dotted'];
    if (!validStyles.includes(value)) {
      return 'phraseBorderStyle must be one of: ' + validStyles.join(', ');
    }
  }
  if (key === 'persistHighlights' || key === 'autoRestoreHighlights') {
    if (typeof value !== 'boolean') return `${key} must be a boolean`;
  }
  if (URL_SETTING_KEYS.has(key) && value !== '' && value !== null) {
    if (typeof value !== 'string') return `${key} must be a string URL`;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return `${key} must be a valid http(s) URL`;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `${key} must be a valid http(s) URL`;
    }
  }
  return null;
}
