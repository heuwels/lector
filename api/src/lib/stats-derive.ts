/**
 * Pure reading-volume derivation, mirrored from src/lib/stats-derive.ts.
 *
 * Only the slice the API needs (deriveReadingStats) lives here; the page-side
 * copy additionally carries the chart helpers. Keep the shared logic in sync.
 */

export interface LessonReadingRow {
  /** Total words in the lesson (lessons.wordCount). */
  wordCount: number;
  /** Furthest scroll position as a percentage, 0..100 (lessons.progress_percentComplete). */
  percentComplete: number;
}

export interface ReadingStats {
  /** Estimated words read across all lessons (approximate — see below). */
  wordsRead: number;
  /** Total words across all lessons (the library size). */
  totalWords: number;
  lessonsTotal: number;
  lessonsStarted: number;
  lessonsCompleted: number;
}

/**
 * Estimate "words read" from per-lesson reading progress. Deliberately
 * approximate: percentComplete is the reader's latest scroll position, not a
 * true measure of words read, but it's the only reading-volume signal captured.
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
