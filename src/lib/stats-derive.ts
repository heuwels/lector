/**
 * Pure derivation helpers for the statistics page.
 *
 * These have no DB or DOM dependencies so they can be unit-tested directly and
 * reused between the API route and the page. The streak/date helpers they lean
 * on live in ./streak and ./dates.
 */

import { addDaysToDateString, dateStringInTimeZone } from './dates';
import type { DailyStats, WordState } from '@/types';

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

/** Minimal dated word record needed to reconstruct vocabulary growth. */
export interface VocabGrowthInput {
  state: WordState;
  /** When the word was first saved (vocab.createdAt). */
  createdAt: string | Date;
  /** When the word last changed state (vocab.stateUpdatedAt). */
  stateUpdatedAt: string | Date;
}

export interface VocabGrowthPoint {
  date: string;
  known: number;
  learning: number;
  total: number;
}

export interface VocabGrowthOptions {
  /**
   * Live word-state counts from the source of truth the stat cards use
   * (knownWords, via /api/stats/fluency). The chart's final point is anchored
   * exactly to these so it agrees with the cards. Any excess the dated vocab
   * can't place in time — e.g. "words I already know" imported as a bare list
   * with no dates — is added as a starting baseline on the earliest day (never
   * dumped on the last day) so the whole curve lands close before the anchor.
   */
  liveTotals?: { known: number; learning: number; new: number };
  /** Extend the series to this calendar date (YYYY-MM-DD) so it reaches today. */
  endDate?: string;
}

/**
 * Reconstruct cumulative vocabulary growth (known / learning / total) over time
 * from the per-word dated event log in the `vocab` table.
 *
 * Why not `dailyStats`? Those per-day deltas (`newWordsSaved`,
 * `wordsMarkedKnown`) are only written by the reader UI, so word level-ups,
 * practice, and imports never register — the cumulative-from-deltas approach
 * left the line flat and a final-point "pin" to the live total then produced a
 * vertical spike on today. `vocab.createdAt` / `stateUpdatedAt` are the only
 * real per-word timestamps, so we rebuild the curve from them instead.
 *
 * Banding, using the two timestamps each word carries (we don't have the full
 * new→level1→…→known transition history, only the current state plus first-seen
 * and last-changed):
 *   - every non-ignored word counts toward `total` from `createdAt`;
 *   - a word currently in a learning level counts as `learning` from `createdAt`;
 *   - a word currently `known` counts as `learning` from `createdAt` until
 *     `stateUpdatedAt`, then as `known` after it;
 *   - `new` words count toward `total` only; `ignored` words are excluded
 *     entirely (matching the fluency total, which excludes ignored).
 * This is exact at both endpoints and a reasonable approximation between.
 *
 * Dates are bucketed in `timeZone` (not UTC) so a word saved near midnight
 * lands on the same calendar day the rest of the app uses.
 */
export function deriveVocabGrowth(
  vocab: VocabGrowthInput[],
  timeZone: string,
  options: VocabGrowthOptions = {},
): VocabGrowthPoint[] {
  const bucket = (d: string | Date) =>
    dateStringInTimeZone(d instanceof Date ? d : new Date(d), timeZone);

  // Accumulate +/- deltas keyed by calendar day, then sweep into a cumulative
  // series. A word currently `known` contributes a learning+1 on its created
  // day and a learning-1 / known+1 on the day it became known.
  const deltas = new Map<string, { known: number; learning: number; total: number }>();
  const bump = (date: string, known: number, learning: number, total: number) => {
    const cur = deltas.get(date) ?? { known: 0, learning: 0, total: 0 };
    cur.known += known;
    cur.learning += learning;
    cur.total += total;
    deltas.set(date, cur);
  };

  for (const w of vocab) {
    if (w.state === 'ignored') continue;
    const created = bucket(w.createdAt);
    bump(created, 0, 0, 1); // enters total
    if (w.state === 'new') continue; // saved, but not yet in a learning band
    bump(created, 0, 1, 0); // entered the learning band when first saved
    if (w.state === 'known') {
      // Moved out of learning into known when it became known. Clamp to the
      // created day so clock skew / re-imports can't push the transition before
      // the word existed.
      let knownOn = bucket(w.stateUpdatedAt);
      if (knownOn < created) knownOn = created;
      bump(knownOn, 1, -1, 0);
    }
  }

  const dates = [...deltas.keys()].sort();
  let cumKnown = 0;
  let cumLearning = 0;
  let cumTotal = 0;
  const points: VocabGrowthPoint[] = [];
  for (const date of dates) {
    const d = deltas.get(date)!;
    cumKnown += d.known;
    cumLearning += d.learning;
    cumTotal += d.total;
    points.push({
      date,
      known: Math.max(0, cumKnown),
      learning: Math.max(0, cumLearning),
      total: Math.max(0, cumTotal),
    });
  }

  // Reconcile the endpoint with the live (knownWords-based) totals the cards
  // show. The residual is knowledge the dated vocab can't place in time — e.g.
  // "words I already know" imported as a bare list with no dates — so attribute
  // it to the earliest day as a starting baseline rather than the last day.
  // This pulls the chart endpoint toward the cards without the today spike.
  //
  // The total baseline is the SUM of the component baselines (not computed
  // independently from the live total) so `total` stays the envelope —
  // known + learning + new can never exceed it, even when `vocab` and
  // `knownWords` disagree. Baselines only add (max(0, …)): if the dated vocab
  // already shows MORE of a band than the cards (the two tables have drifted),
  // the curve keeps the dated truth rather than being forced down.
  if (options.liveTotals) {
    const baseKnown = Math.max(0, options.liveTotals.known - cumKnown);
    const baseLearning = Math.max(0, options.liveTotals.learning - cumLearning);
    const datedNew = Math.max(0, cumTotal - cumKnown - cumLearning);
    const baseNew = Math.max(0, options.liveTotals.new - datedNew);
    const baseTotal = baseKnown + baseLearning + baseNew;
    if (baseKnown || baseLearning || baseTotal) {
      for (const p of points) {
        p.known += baseKnown;
        p.learning += baseLearning;
        p.total += baseTotal;
      }
      cumKnown += baseKnown;
      cumLearning += baseLearning;
      cumTotal += baseTotal;
    }
  }

  // Extend a flat line to today so the chart doesn't stop at the last event.
  if (options.endDate) {
    const last = points[points.length - 1];
    if (!last && options.liveTotals) {
      // No dated vocab at all (e.g. everything imported as a bare list) — still
      // render the live totals as a single endpoint.
      const liveTotal =
        options.liveTotals.known + options.liveTotals.learning + options.liveTotals.new;
      points.push({
        date: options.endDate,
        known: options.liveTotals.known,
        learning: options.liveTotals.learning,
        total: liveTotal,
      });
    } else if (last && options.endDate > last.date) {
      points.push({
        date: options.endDate,
        known: last.known,
        learning: last.learning,
        total: last.total,
      });
    }
  }

  // Anchor the final point exactly to the live card totals, so the chart's
  // endpoint and footer agree with the "Words Known" / "Learning" cards (one
  // source of truth, per the stats page). The baseline above already shaped the
  // whole curve to land close, so this is a tiny final adjustment — not the
  // flat-line-pinned-to-the-total spike that caused the original bug. It also
  // corrects any band where the dated vocab *overshot* knownWords (the two
  // tables drift): baselines can only add, so an overshoot is fixed here.
  if (options.liveTotals && points.length > 0) {
    const finalPt = points[points.length - 1];
    finalPt.known = options.liveTotals.known;
    finalPt.learning = options.liveTotals.learning;
    finalPt.total =
      options.liveTotals.known + options.liveTotals.learning + options.liveTotals.new;
  }

  return points;
}
