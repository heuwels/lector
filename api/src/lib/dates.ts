import { db } from '../db';

// Mirror of src/lib/dates.ts + src/lib/server/dates.ts for the Bun API (the
// two servers share the SQLite file but not source — same pattern as the
// crypto module). Keep the implementations in sync.
//
// All "day" boundaries (daily stats, streaks) are calendar dates in the
// user's configured time zone — never raw UTC (issue #108). The zone is a
// per-user setting, so every caller must say whose day it is (#220) — a
// required param, not a default, or a new call site silently lands on the
// server's zone for every tenant.

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Format a Date as YYYY-MM-DD in the given IANA time zone. */
export function dateStringInTimeZone(date: Date, timeZone: string): string {
  // The en-CA locale formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Add days to a YYYY-MM-DD string. Calendar math only — time-zone independent. */
export function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z'); // noon UTC avoids DST edge cases
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// Day-rollover time zone. Configurable via the `timezone` setting (Settings →
// Time Zone); falls back to the server's local zone.
export function getConfiguredTimeZone(userId: string): string {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE userId = ? AND key = ?').get(userId, 'timezone') as
      | { value: string }
      | undefined;
    if (row) {
      let value: unknown = row.value;
      try {
        value = JSON.parse(row.value);
      } catch {
        // legacy raw-string value
      }
      if (typeof value === 'string' && isValidTimeZone(value)) return value;
    }
  } catch {
    // fall through to the server zone
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Today's date (YYYY-MM-DD) in the user's configured time zone. */
export function getTodayDate(userId: string): string {
  return dateStringInTimeZone(new Date(), getConfiguredTimeZone(userId));
}
