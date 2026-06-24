import { addDaysToDateString, dateStringInTimeZone } from '@/lib/dates';
import { MONTHS } from './constants';
import { darkColorScheme } from './theme';
import type { ActivityDay, HeatmapCell, MonthLabel } from './types';

export function getColor(count: number, maxCount: number, scheme: typeof darkColorScheme): string {
  if (count === 0) {
    return scheme.empty;
  }

  const ratio = count / maxCount;

  if (ratio <= 0.25) {
    return scheme.level1;
  }
  if (ratio <= 0.5) {
    return scheme.level2;
  }
  if (ratio <= 0.75) {
    return scheme.level3;
  }

  return scheme.level4;
}

/**
 * Today's calendar date (YYYY-MM-DD) on this device — the fallback grid endpoint
 * when a caller doesn't pass an explicit, configured-time-zone endDate. Uses the
 * device's IANA zone rather than `toISOString()` so it never lands on the UTC
 * date (which is "yesterday" in the morning for zones ahead of UTC — issue #192).
 */
export function localEndDate(): string {
  return dateStringInTimeZone(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** Day of week (0 = Sunday) for a YYYY-MM-DD string, parsed at noon UTC so the
 *  weekday is stable regardless of the runtime's own time zone. */
function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay();
}

/**
 * Build the calendar grid: 365 days ending on (and including) `endDate`, padded
 * back to the preceding Sunday so every column is a full week.
 *
 * Cells are keyed by calendar-date STRINGS and the whole range is walked with
 * `addDaysToDateString` — no Date→`toISOString()` round-trips. That keeps the
 * cell keys identical to the data's time-zone-aware date keys, so "today" lines
 * up with its activity row instead of being shifted or dropped by a UTC
 * conversion (issue #192).
 */
export function buildHeatmapGrid(
  data: ActivityDay[],
  endDate: string,
): { weeks: HeatmapCell[][]; monthLabels: MonthLabel[] } {
  // date -> the full day record, so each cell can show its breakdown.
  const activityMap = new Map(data.map((d) => [d.date, d]));

  // 365-day window, then back up to the start of its week (Sunday).
  const windowStart = addDaysToDateString(endDate, -364);
  const gridStart = addDaysToDateString(windowStart, -dayOfWeek(windowStart));

  const weeks: HeatmapCell[][] = [];
  let currentWeek: HeatmapCell[] = [];

  const monthLabels: MonthLabel[] = [];
  let lastMonth = -1;
  let weekIndex = 0;

  // String comparison is chronological for zero-padded YYYY-MM-DD.
  for (let cursor = gridStart; cursor <= endDate; cursor = addDaysToDateString(cursor, 1)) {
    const day = activityMap.get(cursor);
    const month = Number(cursor.slice(5, 7)) - 1;

    // One label per month, anchored at the column that first shows it; span is
    // filled in after the loop.
    if (month !== lastMonth) {
      monthLabels.push({ label: MONTHS[month], weekIndex, span: 0 });
      lastMonth = month;
    }

    currentWeek.push({
      date: cursor,
      count: day?.count || 0,
      dayOfWeek: dayOfWeek(cursor),
      parts: day?.parts,
    });

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
      weekIndex++;
    }
  }

  // Push the trailing partial week (today usually isn't a Saturday).
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  // Each label spans from its own column up to the next label's column (the last
  // runs to the end). Spans sum to weeks.length, so they tile grid-cols-53.
  monthLabels.forEach((m, i) => {
    m.span = (monthLabels[i + 1]?.weekIndex ?? weeks.length) - m.weekIndex;
  });

  return { weeks, monthLabels };
}
