/**
 * The `enabledLanguages` setting (#442) — the languages the picker lists for
 * one account. The registry ships every pack; this list is the subset the
 * learner opted into.
 *
 * An empty result means the account has no list yet. Switching language writes
 * one, so a switch is also an opt-in and no caller has to add the code first.
 */
import { db } from '../db';
import { normalizeEnabledLanguages, withLanguageEnabled, type LanguageCode } from './languages';

interface SettingRow {
  value: string;
}

const SETTING_KEY = 'enabledLanguages';

export function readEnabledLanguages(userId: string): LanguageCode[] {
  const row = db
    .prepare('SELECT value FROM settings WHERE userId = ? AND key = ?')
    .get(userId, SETTING_KEY) as SettingRow | undefined;
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    return Array.isArray(parsed) ? normalizeEnabledLanguages(parsed) : [];
  } catch {
    return [];
  }
}

export function writeEnabledLanguages(userId: string, codes: readonly LanguageCode[]): void {
  db.prepare('INSERT OR REPLACE INTO settings (userId, key, value) VALUES (?, ?, ?)').run(
    userId,
    SETTING_KEY,
    JSON.stringify(normalizeEnabledLanguages(codes)),
  );
}

/**
 * Opt the account into `code`. Every writer of `targetLanguage` calls this, so
 * the active language is always in the picker.
 */
export function ensureLanguageEnabled(userId: string, code: LanguageCode): void {
  const current = readEnabledLanguages(userId);
  if (current.includes(code)) return;
  writeEnabledLanguages(userId, withLanguageEnabled(current, code));
}
