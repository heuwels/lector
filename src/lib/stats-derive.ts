/**
 * Pure derivation helpers for the statistics page.
 *
 * These have no DB or DOM dependencies so they can be unit-tested directly and
 * reused between the API route and the page. The streak/date helpers they lean
 * on live in ./streak and ./dates.
 */

import { addDaysToDateString } from './dates';
import type { DailyStats } from '@/types';

export interface LessonReadingRow {
  /** Total words in the lesson (lessons.wordCount). */
  wordCount: number;
  /** Furthest/last scroll position as a percentage, 0..100 (lessons.progress_percentComplete). */
  percentComplete: number;
}

export interface ReadingStats {
  /** Estimated words read across all lessons. See caveat below. */
  wordsRead: number;
  /** Total words across all lessons (the library size). */
  totalWords: number;
  lessonsTotal: number;
  lessonsStarted: number;
  lessonsCompleted: number;
}

/**
 * Estimate "words read" from per-lesson reading progress.
 *
 * This is deliberately approximate. `percentComplete` is the reader's latest
 * scroll position (see MarkdownReader.handleScroll), not a measure of words
 * actually read — it over-counts skimming and is reduced by scrolling back up.
 * It is, however, the only reading-volume signal the app currently captures
 * (`minutesRead` is never written), so the page surfaces it as an estimate with
 * a visible caveat rather than a precise figure.
 */
export function deriveReadingStats(rows: LessonReadingRow[]): ReadingStats {
  let wordsRead = 0;
  let totalWords = 0;
  let lessonsStarted = 0;
  let lessonsCompleted = 0;

  for (const row of rows) {
    const words = Math.max(0, row.wordCount || 0);
    const pct = Math.min(100, Math.max(0, row.percentComplete || 0));
    wordsRead += (words * pct) / 100;
    totalWords += words;
    if (pct > 0) lessonsStarted++;
    if (pct >= 100) lessonsCompleted++;
  }

  return {
    wordsRead: Math.round(wordsRead),
    totalWords,
    lessonsTotal: rows.length,
    lessonsStarted,
    lessonsCompleted,
  };
}

/**
 * Composite daily study-activity magnitude. Matches the streak's definition of
 * an active day (`isActiveDay` in ./streak: a dictionary lookup, cloze review,
 * reading minute, or an Anki review), so the activity heatmap agrees with the
 * streak. Before this the heatmap counted dictionary lookups only, leaving
 * cloze-only days uncoloured even though they keep a streak alive.
 */
export function compositeActivityCount(
  d: Pick<DailyStats, 'dictionaryLookups' | 'clozePracticed' | 'minutesRead' | 'ankiReviews'>,
): number {
  return (
    (d.dictionaryLookups || 0) +
    (d.clozePracticed || 0) +
    (d.minutesRead || 0) +
    (d.ankiReviews || 0)
  );
}

/**
 * Narrow a date-ascending series to the last `days` ending at `endDate`
 * (inclusive). `days === null` returns the whole series unchanged. Only the
 * x-window is narrowed — cumulative values on each point are preserved, so a
 * windowed cumulative chart keeps its real running totals rather than resetting
 * to zero at the window start.
 */
export function sliceSeriesByDays<T extends { date: string }>(
  series: T[],
  days: number | null,
  endDate: string,
): T[] {
  if (days === null) return series;
  const cutoff = addDaysToDateString(endDate, -(days - 1));
  return series.filter((d) => d.date >= cutoff);
}
