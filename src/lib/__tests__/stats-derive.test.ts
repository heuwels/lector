import { describe, it, expect } from 'vitest';
import {
  deriveReadingStats,
  compositeActivityCount,
  deriveVocabGrowth,
  sliceSeriesByDays,
  type VocabGrowthInput,
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

describe('deriveVocabGrowth', () => {
  it('reconstructs a real curve spread across history (no today-spike)', () => {
    // Words saved in-app over months, leveled up over time. createdAt dates are
    // genuinely spread, so the curve should grow on the real event dates.
    const vocab: VocabGrowthInput[] = [
      { state: 'known', createdAt: '2026-01-10T02:00:00Z', stateUpdatedAt: '2026-03-01T02:00:00Z' },
      { state: 'level2', createdAt: '2026-02-15T02:00:00Z', stateUpdatedAt: '2026-04-01T02:00:00Z' },
      { state: 'level1', createdAt: '2026-03-20T02:00:00Z', stateUpdatedAt: '2026-03-20T02:00:00Z' },
    ];
    const out = deriveVocabGrowth(vocab, 'UTC', { endDate: '2026-06-18' });

    expect(out).toEqual([
      { date: '2026-01-10', known: 0, learning: 1, total: 1 },
      { date: '2026-02-15', known: 0, learning: 2, total: 2 },
      { date: '2026-03-01', known: 1, learning: 1, total: 2 }, // word 1 graduates to known
      { date: '2026-03-20', known: 1, learning: 2, total: 3 },
      { date: '2026-06-18', known: 1, learning: 2, total: 3 }, // flat line out to today
    ]);
    // The growth is attributed to real dates, not collapsed onto today.
    expect(out[0].date).toBe('2026-01-10');
  });

  it('keeps the endpoint equal to the live card totals when vocab accounts for everything', () => {
    const vocab: VocabGrowthInput[] = [
      { state: 'known', createdAt: '2026-01-10T02:00:00Z', stateUpdatedAt: '2026-03-01T02:00:00Z' },
      { state: 'level2', createdAt: '2026-02-15T02:00:00Z', stateUpdatedAt: '2026-04-01T02:00:00Z' },
      { state: 'level1', createdAt: '2026-03-20T02:00:00Z', stateUpdatedAt: '2026-03-20T02:00:00Z' },
    ];
    const out = deriveVocabGrowth(vocab, 'UTC', {
      liveTotals: { known: 1, learning: 2, new: 0 }, // residual 0 → no baseline shift
      endDate: '2026-06-18',
    });
    const last = out[out.length - 1];
    expect({ known: last.known, learning: last.learning, total: last.total }).toEqual({
      known: 1,
      learning: 2,
      total: 3,
    });
    expect(out[0]).toEqual({ date: '2026-01-10', known: 0, learning: 1, total: 1 }); // no baseline added
  });

  it('puts a bulk import as a step on the import day, never on today (regression)', () => {
    // The old reconstruction left history flat and pinned the live total onto
    // the last point, so a past import showed up as a spike on *today*. The
    // reconstruction must instead place the step on the actual import day.
    const vocab: VocabGrowthInput[] = Array.from({ length: 5 }, () => ({
      state: 'level1' as const,
      createdAt: '2026-04-13T02:00:00Z',
      stateUpdatedAt: '2026-04-13T02:00:00Z',
    }));
    const out = deriveVocabGrowth(vocab, 'UTC', { endDate: '2026-06-18' });

    const importDay = out.find((p) => p.date === '2026-04-13')!;
    expect(importDay.learning).toBe(5); // full value already on the import day
    expect(out[out.length - 1]).toEqual({
      date: '2026-06-18',
      known: 0,
      learning: 5, // flat — no extra jump on today
      total: 5,
    });
    expect(importDay.learning).toBe(out[out.length - 1].learning);
  });

  it('attributes dateless imported known words to a starting baseline, not today', () => {
    // The cards (knownWords) say 100 known, but only 2 words have dated vocab
    // rows — the other 98 were imported as a bare list with no dates. The excess
    // should sit as a baseline on the earliest day, with the endpoint matching
    // the cards and no terminal spike.
    const vocab: VocabGrowthInput[] = [
      { state: 'level1', createdAt: '2026-05-01T02:00:00Z', stateUpdatedAt: '2026-05-01T02:00:00Z' },
      { state: 'known', createdAt: '2026-05-02T02:00:00Z', stateUpdatedAt: '2026-05-10T02:00:00Z' },
    ];
    const out = deriveVocabGrowth(vocab, 'UTC', {
      liveTotals: { known: 100, learning: 1, new: 0 },
      endDate: '2026-06-18',
    });

    // baseline = liveKnown(100) − dated known(1) = 99, applied from the earliest day.
    expect(out[0].known).toBe(99);
    const last = out[out.length - 1];
    expect(last.known).toBe(100); // endpoint matches the card
    expect(last.learning).toBe(1);
    expect(last.total).toBe(101);
    // No spike: the last real-event value already equals the endpoint value.
    const may10 = out.find((p) => p.date === '2026-05-10')!;
    expect(may10.known).toBe(100);
  });

  it('anchors the endpoint to the cards and keeps total as the envelope under drift', () => {
    // The dated vocab shows MORE learning (3) than the cards report (1) — the
    // two tables (vocab vs knownWords) have drifted — plus dateless imported
    // known words. `total` must never be exceeded by known + learning at any
    // point, and the final point must match the cards exactly (a baseline can
    // only add, so it can't fix learning's overshoot — the endpoint anchor does).
    const vocab: VocabGrowthInput[] = [
      { state: 'level1', createdAt: '2026-05-01T02:00:00Z', stateUpdatedAt: '2026-05-01T02:00:00Z' },
      { state: 'level1', createdAt: '2026-05-02T02:00:00Z', stateUpdatedAt: '2026-05-02T02:00:00Z' },
      { state: 'level1', createdAt: '2026-05-03T02:00:00Z', stateUpdatedAt: '2026-05-03T02:00:00Z' },
    ];
    const out = deriveVocabGrowth(vocab, 'UTC', {
      liveTotals: { known: 10, learning: 1, new: 0 }, // 10 dateless known; learning drift
      endDate: '2026-06-18',
    });
    for (const p of out) {
      expect(p.known + p.learning).toBeLessThanOrEqual(p.total);
    }
    const last = out[out.length - 1];
    expect(last.known).toBe(10); // dateless known baseline + anchor
    expect(last.learning).toBe(1); // anchored to the card, not vocab's overshoot of 3
    expect(last.total).toBe(11); // known + learning + new
  });

  it('treats a known word as learning until it became known, then known after', () => {
    const out = deriveVocabGrowth(
      [{ state: 'known', createdAt: '2026-02-01T02:00:00Z', stateUpdatedAt: '2026-02-20T02:00:00Z' }],
      'UTC',
    );
    expect(out).toEqual([
      { date: '2026-02-01', known: 0, learning: 1, total: 1 },
      { date: '2026-02-20', known: 1, learning: 0, total: 1 },
    ]);
  });

  it('excludes ignored words and counts new words toward total only', () => {
    const out = deriveVocabGrowth(
      [
        { state: 'ignored', createdAt: '2026-02-01T02:00:00Z', stateUpdatedAt: '2026-02-01T02:00:00Z' },
        { state: 'new', createdAt: '2026-02-02T02:00:00Z', stateUpdatedAt: '2026-02-02T02:00:00Z' },
      ],
      'UTC',
    );
    expect(out).toEqual([{ date: '2026-02-02', known: 0, learning: 0, total: 1 }]);
  });

  it('buckets dates in the configured time zone, not UTC', () => {
    const word: VocabGrowthInput = {
      state: 'level1',
      createdAt: '2026-03-10T14:00:00Z', // 2026-03-11 00:00 in Brisbane (UTC+10)
      stateUpdatedAt: '2026-03-10T14:00:00Z',
    };
    expect(deriveVocabGrowth([word], 'Australia/Brisbane')[0].date).toBe('2026-03-11');
    expect(deriveVocabGrowth([word], 'UTC')[0].date).toBe('2026-03-10');
  });

  it('clamps a stateUpdatedAt that precedes createdAt (clock skew)', () => {
    const out = deriveVocabGrowth(
      [{ state: 'known', createdAt: '2026-02-10T02:00:00Z', stateUpdatedAt: '2026-01-01T02:00:00Z' }],
      'UTC',
    );
    // Both events collapse onto the created day; no known is recorded before the word existed.
    expect(out).toEqual([{ date: '2026-02-10', known: 1, learning: 0, total: 1 }]);
  });

  it('renders live totals as a single endpoint when there is no dated vocab', () => {
    expect(
      deriveVocabGrowth([], 'UTC', { liveTotals: { known: 50, learning: 0, new: 0 }, endDate: '2026-06-18' }),
    ).toEqual([{ date: '2026-06-18', known: 50, learning: 0, total: 50 }]);
  });

  it('returns an empty series for no vocab and no live totals', () => {
    expect(deriveVocabGrowth([], 'UTC')).toEqual([]);
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
