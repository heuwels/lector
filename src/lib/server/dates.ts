import { db } from './database';
import { dateStringInTimeZone, isValidTimeZone } from '@/lib/dates';

// Day-rollover time zone for daily stats and streaks. Configurable via the
// `timezone` setting (Settings → Time Zone); falls back to the server's local
// zone. Mirrored in api/src/lib/dates.ts.

export function getConfiguredTimeZone(): string {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('timezone') as
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

/** Today's date (YYYY-MM-DD) in the configured time zone. */
export function getTodayDate(): string {
  return dateStringInTimeZone(new Date(), getConfiguredTimeZone());
}
