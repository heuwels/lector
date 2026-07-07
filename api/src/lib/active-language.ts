import { db } from '../db';
import { type LanguageCode, LANGUAGES, DEFAULT_LANGUAGE, isValidLanguageCode } from './languages';

interface SettingRow {
  value: string;
}

// targetLanguage is a per-user setting, so resolution needs to know whose
// default to read (#220) — required params, same rationale as dates.ts.

export function getActiveLanguageCode(userId: string): LanguageCode {
  const row = db.prepare('SELECT value FROM settings WHERE userId = ? AND key = ?').get(userId, 'targetLanguage') as SettingRow | undefined;
  if (!row) return DEFAULT_LANGUAGE;

  // Value may be JSON-encoded (e.g. '"af"') or raw (e.g. 'af')
  const raw = row.value.replace(/^"|"$/g, '');
  if (isValidLanguageCode(raw)) return raw;

  return DEFAULT_LANGUAGE;
}

export function getActiveLanguageConfig(userId: string) {
  return LANGUAGES[getActiveLanguageCode(userId)];
}

export function resolveLanguage(requestLang: string | null | undefined, userId: string): LanguageCode {
  if (requestLang && isValidLanguageCode(requestLang)) return requestLang;
  return getActiveLanguageCode(userId);
}
