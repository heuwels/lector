import { describe, it, expect } from 'vitest';
import { computeStreaks, isActiveDay, activeDateSet } from '../streak';

describe('computeStreaks', () => {
  it('counts consecutive days through today (the Mon/Tue/Wed issue #108 case)', () => {
    const active = new Set(['2026-06-08', '2026-06-09', '2026-06-10']);
    expect(computeStreaks(active, '2026-06-10')).toEqual({
      current: 3,
      longest: 3,
      activeToday: true,
    });
  });

  it('keeps the streak alive when today has no activity yet', () => {
    const active = new Set(['2026-06-08', '2026-06-09']);
    expect(computeStreaks(active, '2026-06-10')).toEqual({
      current: 2,
      longest: 2,
      activeToday: false,
    });
  });

  it('resets current after a full missed day, but longest remembers the run', () => {
    const active = new Set(['2026-06-05', '2026-06-06', '2026-06-07']);
    const result = computeStreaks(active, '2026-06-10');
    expect(result.current).toBe(0);
    expect(result.longest).toBe(3);
  });

  it('finds the longest run among several', () => {
    const active = new Set([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-06',
      '2026-06-09',
      '2026-06-10',
    ]);
    expect(computeStreaks(active, '2026-06-10')).toEqual({
      current: 2,
      longest: 3,
      activeToday: true,
    });
  });

  it('handles month boundaries inside a run', () => {
    const active = new Set(['2026-02-28', '2026-03-01']);
    expect(computeStreaks(active, '2026-03-01').current).toBe(2);
  });

  it('returns zeros for no activity', () => {
    expect(computeStreaks(new Set(), '2026-06-10')).toEqual({
      current: 0,
      longest: 0,
      activeToday: false,
    });
  });
});

describe('isActiveDay', () => {
  it('counts any study activity', () => {
    expect(isActiveDay({ date: 'd', dictionaryLookups: 1 })).toBe(true);
    expect(isActiveDay({ date: 'd', clozePracticed: 5 })).toBe(true);
    expect(isActiveDay({ date: 'd', minutesRead: 12 })).toBe(true);
    // An Anki-only day keeps the streak alive (reviews synced from AnkiConnect).
    expect(isActiveDay({ date: 'd', ankiReviews: 8 })).toBe(true);
  });

  it('is false for zero or missing activity', () => {
    expect(
      isActiveDay({ date: 'd', dictionaryLookups: 0, clozePracticed: 0, minutesRead: 0, ankiReviews: 0 }),
    ).toBe(false);
    expect(isActiveDay({ date: 'd' })).toBe(false);
    expect(isActiveDay({ date: 'd', dictionaryLookups: null, minutesRead: null, ankiReviews: null })).toBe(
      false,
    );
  });
});

describe('activeDateSet', () => {
  it('keeps only active days', () => {
    const set = activeDateSet([
      { date: '2026-06-09', clozePracticed: 3 },
      { date: '2026-06-10', dictionaryLookups: 0, clozePracticed: 0 },
    ]);
    expect(set.has('2026-06-09')).toBe(true);
    expect(set.has('2026-06-10')).toBe(false);
  });

  it('includes a day that only had Anki reviews', () => {
    const set = activeDateSet([
      { date: '2026-06-09', dictionaryLookups: 0, clozePracticed: 0, minutesRead: 0, ankiReviews: 12 },
    ]);
    expect(set.has('2026-06-09')).toBe(true);
  });
});
