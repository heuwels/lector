/**
 * Single source of truth for the settings-table key policy (#233).
 *
 * SENSITIVE_KEYS are credentials: the settings GET routes mask them as `true`,
 * and the full-DB export (`GET /api/data`) replaces their values with
 * REDACTION_SENTINEL so a backup never carries live keys.
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

export const SENSITIVE_KEYS = new Set([
  'anthropicApiKey',
  'claudeOauthToken',
  'lmstudioApiKey',
  'openaiApiKey',
]);

export const REDACTION_SENTINEL = '__REDACTED__';

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
export function validateSettingWrite(key: string, value: unknown): string | null {
  if (!KNOWN_SETTING_KEYS.has(key)) return `Unknown setting key: ${key}`;
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
