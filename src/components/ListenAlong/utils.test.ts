import { describe, expect, test } from 'vitest';
import type { AudioTranscriptSegment } from '@/types';
import { activeSegmentIndex, formatClock, nextPlaybackRate, PLAYBACK_RATES } from './utils';

const SEGMENTS: AudioTranscriptSegment[] = [
  { idx: 0, startMs: 0, endMs: 2000, text: 'Een.' },
  { idx: 1, startMs: 2000, endMs: 4500, text: 'Twee.' },
  // Gap between 4500 and 5000 (silence in the recording).
  { idx: 2, startMs: 5000, endMs: 7000, text: 'Drie.' },
];

describe('activeSegmentIndex', () => {
  test('locates the segment containing the playhead', () => {
    expect(activeSegmentIndex(SEGMENTS, 0)).toBe(0);
    expect(activeSegmentIndex(SEGMENTS, 1999)).toBe(0);
    expect(activeSegmentIndex(SEGMENTS, 2000)).toBe(1);
    expect(activeSegmentIndex(SEGMENTS, 6500)).toBe(2);
  });

  test('keeps the last passed segment during a silence gap and past the end', () => {
    expect(activeSegmentIndex(SEGMENTS, 4700)).toBe(1);
    expect(activeSegmentIndex(SEGMENTS, 99000)).toBe(2);
  });

  test('is -1 before the first segment starts', () => {
    expect(activeSegmentIndex([{ idx: 0, startMs: 500, endMs: 900, text: 'x' }], 100)).toBe(-1);
    expect(activeSegmentIndex([], 0)).toBe(-1);
  });
});

describe('formatClock', () => {
  test('formats minutes and hours', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(83_000)).toBe('1:23');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('nextPlaybackRate', () => {
  test('cycles through the rate ladder and wraps', () => {
    expect(nextPlaybackRate(1)).toBe(1.25);
    expect(nextPlaybackRate(2)).toBe(0.5);
  });

  test('recovers to the start of the ladder from an unknown rate', () => {
    expect(nextPlaybackRate(3)).toBe(PLAYBACK_RATES[0]);
  });
});
