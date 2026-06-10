// Mirror of src/lib/streak.ts for the Bun API — keep in sync.
// Single source of truth for streak math (issue #108): a day counts toward
// the streak when any study activity happened (lookup, practice, or reading).

import { addDaysToDateString } from './dates';

export interface DailyActivityRow {
  date: string;
  dictionaryLookups?: number | null;
  clozePracticed?: number | null;
  minutesRead?: number | null;
}

export function isActiveDay(row: DailyActivityRow): boolean {
  return (
    (row.dictionaryLookups ?? 0) > 0 ||
    (row.clozePracticed ?? 0) > 0 ||
    (row.minutesRead ?? 0) > 0
  );
}

export function activeDateSet(rows: DailyActivityRow[]): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    if (isActiveDay(row)) set.add(row.date);
  }
  return set;
}

export interface StreakResult {
  current: number;
  longest: number;
  activeToday: boolean;
}

/**
 * Compute current and longest streaks from a set of active YYYY-MM-DD dates.
 * `today` must already be expressed in the user's configured time zone.
 */
export function computeStreaks(activeDates: Set<string>, today: string): StreakResult {
  const activeToday = activeDates.has(today);

  let current = 0;
  let cursor = activeToday ? today : addDaysToDateString(today, -1);
  while (activeDates.has(cursor)) {
    current++;
    cursor = addDaysToDateString(cursor, -1);
  }

  let longest = 0;
  for (const date of activeDates) {
    if (activeDates.has(addDaysToDateString(date, -1))) continue; // not a run start
    let length = 1;
    let next = addDaysToDateString(date, 1);
    while (activeDates.has(next)) {
      length++;
      next = addDaysToDateString(next, 1);
    }
    if (length > longest) longest = length;
  }

  return { current, longest, activeToday };
}
