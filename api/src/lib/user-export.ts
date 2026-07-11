/**
 * Full per-user data export (#225 takeout; reused by the admin dashboard
 * #221 to export any account on the operator's behalf). One builder, so the
 * self-service export (GET /api/data) and the admin-triggered export produce
 * byte-identical payloads and can never drift.
 */
import { db, SettingRow } from '../db';
import { SENSITIVE_KEYS, REDACTION_SENTINEL } from './settings-keys';

export interface UserExport {
  exportedAt: string;
  collections: unknown[];
  collectionGroups: unknown[];
  lessons: unknown[];
  vocab: unknown[];
  knownWords: unknown[];
  clozeSentences: unknown[];
  dailyStats: unknown[];
  learnerProfiles: unknown[];
  onboardingProgress: unknown[];
  learnerEvents: unknown[];
  settings: SettingRow[];
}

/**
 * Everything owned by `userId`, in restore-ready shape. Credentials are
 * redacted (never hand out API keys in cleartext, #233) — the sentinel keeps
 * the key visible so restore knows to skip it.
 */
export function buildUserExport(userId: string): UserExport {
  const settings = (
    db.prepare('SELECT * FROM settings WHERE userId = ?').all(userId) as SettingRow[]
  ).map((s) => (SENSITIVE_KEYS.has(s.key) ? { ...s, value: REDACTION_SENTINEL } : s));

  return {
    exportedAt: new Date().toISOString(),
    collections: db.prepare('SELECT * FROM collections WHERE userId = ?').all(userId),
    collectionGroups: db.prepare('SELECT * FROM collection_groups WHERE userId = ?').all(userId),
    lessons: db.prepare('SELECT * FROM lessons WHERE userId = ?').all(userId),
    vocab: db.prepare('SELECT * FROM vocab WHERE userId = ?').all(userId),
    knownWords: db.prepare('SELECT * FROM knownWords WHERE userId = ?').all(userId),
    clozeSentences: db.prepare('SELECT * FROM clozeSentences WHERE userId = ?').all(userId),
    dailyStats: db.prepare('SELECT * FROM dailyStats WHERE userId = ?').all(userId),
    learnerProfiles: db.prepare('SELECT * FROM learner_profiles WHERE userId = ?').all(userId),
    onboardingProgress: db
      .prepare('SELECT * FROM onboarding_progress WHERE userId = ?')
      .all(userId),
    learnerEvents: db
      .prepare('SELECT * FROM learner_events WHERE userId = ? ORDER BY occurredAt, rowid')
      .all(userId),
    settings,
  };
}
