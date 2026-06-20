import { test, expect } from 'bun:test';
import { deriveReadingStats } from './stats-derive';

test('deriveReadingStats weights words by progress and counts lesson states', () => {
  const stats = deriveReadingStats([
    { wordCount: 100, percentComplete: 50 }, // 50 read, started
    { wordCount: 200, percentComplete: 100 }, // 200 read, started + completed
    { wordCount: 80, percentComplete: 0 }, // 0 read, untouched
  ]);
  expect(stats).toEqual({
    wordsRead: 250,
    totalWords: 380,
    lessonsTotal: 3,
    lessonsStarted: 2,
    lessonsCompleted: 1,
  });
});

test('deriveReadingStats clamps out-of-range progress and negative counts', () => {
  const stats = deriveReadingStats([
    { wordCount: -10, percentComplete: 50 }, // negative wordCount clamps to 0
    { wordCount: 100, percentComplete: 150 }, // pct clamps to 100
  ]);
  expect(stats.wordsRead).toBe(100);
  expect(stats.totalWords).toBe(100);
  // Both rows have percentComplete > 0, so both count as started (the first
  // still "started" even though its word count clamped to 0).
  expect(stats.lessonsStarted).toBe(2);
  expect(stats.lessonsCompleted).toBe(1);
});

test('deriveReadingStats handles an empty library', () => {
  expect(deriveReadingStats([])).toEqual({
    wordsRead: 0,
    totalWords: 0,
    lessonsTotal: 0,
    lessonsStarted: 0,
    lessonsCompleted: 0,
  });
});
