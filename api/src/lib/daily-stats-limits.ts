import { db } from '../db';
import { entitlements, type EntitlementsEngine, type LimitVerdict } from './entitlements';

export interface DailyStatsKey {
  date: string;
  language: string;
}

/** Reserve only net-new (date, language) keys, then perform the writes in the
 * same SQLite transaction. Existing days remain updateable after downgrade. */
export function reserveDailyStatsRows(
  userId: string,
  keys: readonly DailyStatsKey[],
  commit: () => void,
  engine: EntitlementsEngine = entitlements,
): LimitVerdict {
  const unique = new Map(keys.map((key) => [`${key.language}\0${key.date}`, key]));
  const existing = new Set(
    (
      db.prepare('SELECT date, language FROM dailyStats WHERE userId = ?').all(userId) as Array<{
        date: string;
        language: string;
      }>
    ).map((row) => `${row.language}\0${row.date}`),
  );
  const netNew = [...unique.keys()].filter((key) => !existing.has(key)).length;
  return engine.reserveCount(
    userId,
    netNew > 0 ? [{ metric: 'maxDailyStatsRows', requested: netNew }] : [],
    commit,
  );
}
