import { db } from '../db';
import { type LanguageCode, LANGUAGES, DEFAULT_LANGUAGE, isValidLanguageCode } from './languages';

interface SettingRow {
  value: string;
}

export function getActiveLanguageCode(): LanguageCode {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('targetLanguage') as SettingRow | undefined;
  if (!row) return DEFAULT_LANGUAGE;

  try {
    const code = JSON.parse(row.value);
    if (typeof code === 'string' && isValidLanguageCode(code)) return code;
  } catch {
    if (typeof row.value === 'string' && isValidLanguageCode(row.value)) return row.value;
  }

  return DEFAULT_LANGUAGE;
}

export function getActiveLanguageConfig() {
  return LANGUAGES[getActiveLanguageCode()];
}

export function resolveLanguage(requestLang?: string | null): LanguageCode {
  if (requestLang && isValidLanguageCode(requestLang)) return requestLang;
  return getActiveLanguageCode();
}
