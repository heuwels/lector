// CEFR-style vocabulary levels and progress derivation.
//
// The progress bar measures progress *through the current band* (it resets to
// 0% on entering a level and fills to 100% as you approach the next), rather
// than total words as a fraction of the next threshold. Banded is deliberate:
// a cumulative `known / nextThreshold` would show a near-beginner as e.g. "10%
// to C2", which is meaningless. Each level is a fresh, winnable 0→100.
//
// Mirror: api/src/lib/cefr.ts — keep both copies in sync (the Next.js and Hono
// servers share the SQLite file but not source).

export interface CefrLevelInfo {
  code: string;
  label: string;
  min: number;
  /** Upper bound of the band, or null for the open-ended top level (C2). */
  max: number | null;
}

export interface CefrProgress {
  estimatedLevel: CefrLevelInfo;
  /** The level above the current one, or null at the top level. */
  nextLevel: { code: string; label: string } | null;
  /** 0..100, progress through the current band. */
  progressToNextLevel: number;
  /** Words still needed to reach the next level, or null at the top level. */
  wordsToNextLevel: number | null;
}

const CEFR_LEVELS = [
  { min: 0, max: 500, code: 'A1', label: 'Beginner' },
  { min: 500, max: 1500, code: 'A2', label: 'Elementary' },
  { min: 1500, max: 3000, code: 'B1', label: 'Intermediate' },
  { min: 3000, max: 5000, code: 'B2', label: 'Upper Intermediate' },
  { min: 5000, max: 8000, code: 'C1', label: 'Advanced' },
  { min: 8000, max: Infinity, code: 'C2', label: 'Proficiency' },
] as const;

export function deriveCefrProgress(totalKnownWords: number): CefrProgress {
  const idx = CEFR_LEVELS.findIndex((l) => totalKnownWords >= l.min && totalKnownWords < l.max);
  const currentIndex = idx === -1 ? CEFR_LEVELS.length - 1 : idx;
  const current = CEFR_LEVELS[currentIndex];
  const next = CEFR_LEVELS[currentIndex + 1] ?? null;
  const isTopLevel = current.max === Infinity;

  const progressToNextLevel = isTopLevel
    ? 100
    : Math.round(((totalKnownWords - current.min) / (current.max - current.min)) * 100);

  const wordsToNextLevel = isTopLevel ? null : Math.max(0, current.max - totalKnownWords);

  return {
    estimatedLevel: {
      code: current.code,
      label: current.label,
      min: current.min,
      max: isTopLevel ? null : current.max,
    },
    nextLevel: next ? { code: next.code, label: next.label } : null,
    progressToNextLevel,
    wordsToNextLevel,
  };
}
