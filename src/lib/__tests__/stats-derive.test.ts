import { describe, it, expect } from 'vitest';
import {
  deriveReadingStats,
  compositeActivityCount,
  sliceSeriesByDays,
} from '../stats-derive';

describe('deriveReadingStats', () => {
  it('returns zeros for no lessons', () => {
    expect(deriveReadingStats([])).toEqual({
      wordsRead: 0,
      totalWords: 0,
      lessonsTotal: 0,
      lessonsStarted: 0,
      lessonsCompleted: 0,
    });
  });

  it('prorates words read by percent complete', () => {
    const stats = deriveReadingStats([
      { wordCount: 1000, percentComplete: 50 },
      { wordCount: 400, percentComplete: 25 },
    ]);
    expect(stats.wordsRead).toBe(600); // 500 + 100
    expect(stats.totalWords).toBe(1400);
    expect(stats.lessonsTotal).toBe(2);
    expect(stats.lessonsStarted).toBe(2);
    expect(stats.lessonsCompleted).toBe(0);
  });

  it('counts started and completed lessons by progress', () => {
    const stats = deriveReadingStats([
      { wordCount: 100, percentComplete: 0 }, // not started
      { wordCount: 100, percentComplete: 1 }, // started
      { wordCount: 100, percentComplete: 100 }, // completed (and started)
    ]);
    expect(stats.lessonsStarted).toBe(2);
    expect(stats.lessonsCompleted).toBe(1);
  });

  it('clamps out-of-range percentages and rounds the estimate', () => {
    const stats = deriveReadingStats([
      { wordCount: 100, percentComplete: 150 }, // clamps to 100 -> 100
      { wordCount: 100, percentComplete: -20 }, // clamps to 0 -> 0
      { wordCount: 300, percentComplete: 33 }, // 99
    ]);
    expect(stats.wordsRead).toBe(199);
    expect(stats.lessonsCompleted).toBe(1); // the clamped-to-100 one
  });

  it('treats missing word counts as zero', () => {
    const stats = deriveReadingStats([
      { wordCount: undefined as unknown as number, percentComplete: 50 },
    ]);
    expect(stats.wordsRead).toBe(0);
    expect(stats.totalWords).toBe(0);
  });
});

describe('compositeActivityCount', () => {
  it('sums the activity signals (lookups + cloze + reading + Anki)', () => {
    expect(
      compositeActivityCount({
        dictionaryLookups: 5,
        clozePracticed: 3,
        minutesRead: 12,
        ankiReviews: 7,
      }),
    ).toBe(27);
  });

  it('is non-zero whenever any single signal is present (matches the streak)', () => {
    expect(
      compositeActivityCount({ dictionaryLookups: 0, clozePracticed: 4, minutesRead: 0, ankiReviews: 0 }),
    ).toBe(4);
    // An Anki-only day still registers on the heatmap, like the streak.
    expect(
      compositeActivityCount({ dictionaryLookups: 0, clozePracticed: 0, minutesRead: 0, ankiReviews: 6 }),
    ).toBe(6);
    expect(
      compositeActivityCount({ dictionaryLookups: 0, clozePracticed: 0, minutesRead: 0, ankiReviews: 0 }),
    ).toBe(0);
  });

  it('tolerates missing fields', () => {
    expect(
      compositeActivityCount({
        dictionaryLookups: 2,
      } as Parameters<typeof compositeActivityCount>[0]),
    ).toBe(2);
  });
});

describe('sliceSeriesByDays', () => {
  const series = [
    { date: '2026-06-01', v: 1 },
    { date: '2026-06-08', v: 2 },
    { date: '2026-06-12', v: 3 },
    { date: '2026-06-14', v: 4 },
  ];

  it('returns the whole series for a null window', () => {
    expect(sliceSeriesByDays(series, null, '2026-06-14')).toEqual(series);
  });

  it('keeps only entries within the trailing window (inclusive boundary)', () => {
    // 7-day window ending 2026-06-14 -> cutoff 2026-06-08
    const out = sliceSeriesByDays(series, 7, '2026-06-14');
    expect(out.map((d) => d.date)).toEqual(['2026-06-08', '2026-06-12', '2026-06-14']);
  });

  it('preserves the original point values within the window', () => {
    const out = sliceSeriesByDays(series, 3, '2026-06-14');
    expect(out).toEqual([
      { date: '2026-06-12', v: 3 },
      { date: '2026-06-14', v: 4 },
    ]);
  });
});
