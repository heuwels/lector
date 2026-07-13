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
import { isValidLanguageCode } from './languages';

export const SENSITIVE_KEYS = new Set([
  'anthropicApiKey',
  'claudeOauthToken',
  'lmstudioApiKey',
  'openaiApiKey',
]);

export const REDACTION_SENTINEL = '__REDACTED__';
export const MAX_SETTING_VALUE_BYTES = 64 * 1024;

export const URL_SETTING_KEYS = new Set(['openaiUrl', 'ankiConnectUrl', 'apfelUrl', 'lmstudioUrl']);

export const KNOWN_SETTING_KEYS = new Set([
  // Core
  'targetLanguage',
  'timezone',
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
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SETTING_VALUE_BYTES) {
    return `${key} exceeds the ${MAX_SETTING_VALUE_BYTES}-byte setting limit`;
  }
  if (key === 'targetLanguage' && (typeof value !== 'string' || !isValidLanguageCode(value))) {
    return 'targetLanguage must be a supported language';
  }
  if (key === 'ankiTransport' && value !== '' && value !== null) {
    if (typeof value !== 'string' || !ANKI_TRANSPORTS.has(value)) {
      return "ankiTransport must be 'ankiconnect' or 'addon'";
    }
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
