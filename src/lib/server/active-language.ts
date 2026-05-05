import { db } from './database';
import { type LanguageCode, LANGUAGES, DEFAULT_LANGUAGE, isValidLanguageCode } from '../languages';

interface SettingRow {
  value: string;
}

export function getActiveLanguageCode(): LanguageCode {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('targetLanguage') as SettingRow | undefined;
  if (!row) return DEFAULT_LANGUAGE;

  // Value may be JSON-encoded (e.g. '"af"') or raw (e.g. 'af')
  const raw = row.value.replace(/^"|"$/g, '');
  if (isValidLanguageCode(raw)) return raw;

  return DEFAULT_LANGUAGE;
}

export function getActiveLanguageConfig() {
  return LANGUAGES[getActiveLanguageCode()];
}

export function resolveLanguage(requestLang?: string | null): LanguageCode {
  if (requestLang && isValidLanguageCode(requestLang)) return requestLang;
  return getActiveLanguageCode();
}
