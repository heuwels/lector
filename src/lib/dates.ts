// Pure date helpers shared by client and server code.
// Mirrored for the Bun API in api/src/lib/dates.ts (the two servers share the
// SQLite file but not source — same pattern as the crypto module).
//
// All "day" boundaries in Lector (daily stats, streaks) are calendar dates in
// the user's configured time zone — never raw UTC (issue #108).

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
