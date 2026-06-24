import { db } from '../db';
import { getTodayDate } from './dates';

// Record the once-per-day "study session started" ping for a language: ensure the
// (date, language) dailyStats row exists, then stamp sessionStartedAt the first
// time it's called that day (COALESCE keeps the earliest start).
//
// dailyStats has a compound (date, language) PK, so every write MUST target the
// active language's row. A language-less INSERT misattributes the row to the
// table default ('af'), and a language-less UPDATE bleeds sessionStartedAt across
// every language's row for the day. This helper is the single source of truth for
// that write — shared by /translate, /dictionary, and /study-ping so the three
// callers can't drift apart again (which is exactly how the /translate copy ended
// up language-less and on a raw-UTC day boundary). Uses getTodayDate() so the day
// rollover matches every other stats writer (timezone-aware, never raw UTC).
export function recordStudySessionPing(language: string): void {
  const today = getTodayDate();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO dailyStats
      (date, language, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
     VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0)`,
  ).run(today, language);
  db.prepare(
    'UPDATE dailyStats SET sessionStartedAt = COALESCE(sessionStartedAt, ?) WHERE date = ? AND language = ?',
  ).run(now, today, language);
}
