import type { TranscriptSegment } from '@/types';

/**
 * The segment the playhead is inside (or the last one it passed): greatest idx
 * with startMs <= ms. Pure lookup over the ordered segment array — sync never
 * depends on text offsets, so transcript edits can't break it. -1 before the
 * first segment.
 */
export function activeSegmentIndex(segments: TranscriptSegment[], ms: number): number {
  let low = 0;
  let high = segments.length - 1;
  let answer = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].startMs <= ms) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

/** 83000 → "1:23"; 3723000 → "1:02:03". */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const mmss = `${minutes}:${String(seconds).padStart(2, '0')}`;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : mmss;
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function nextPlaybackRate(current: number): number {
  const index = PLAYBACK_RATES.findIndex((rate) => rate === current);
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? 1;
}
