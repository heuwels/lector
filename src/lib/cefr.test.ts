import { describe, it, expect } from 'vitest';
import { deriveCefrProgress } from './cefr';

describe('deriveCefrProgress', () => {
  it('places 0 words at the start of A1', () => {
    const p = deriveCefrProgress(0);
    expect(p.estimatedLevel.code).toBe('A1');
    expect(p.progressToNextLevel).toBe(0);
    expect(p.nextLevel?.code).toBe('A2');
    expect(p.wordsToNextLevel).toBe(500);
  });

  it('measures progress THROUGH the current band, not as a fraction of the next threshold', () => {
    // 709 known in A2 (500–1500): (709-500)/(1500-500) = 20.9% → 21%, NOT 709/1500 = 47%.
    const p = deriveCefrProgress(709);
    expect(p.estimatedLevel.code).toBe('A2');
    expect(p.estimatedLevel.min).toBe(500);
    expect(p.estimatedLevel.max).toBe(1500);
    expect(p.progressToNextLevel).toBe(21);
    expect(p.nextLevel?.code).toBe('B1');
    expect(p.wordsToNextLevel).toBe(791);
  });

  it('resets to 0% on entering a new level', () => {
    // Exactly at a boundary: 1500 is the floor of B1, so progress restarts.
    const p = deriveCefrProgress(1500);
    expect(p.estimatedLevel.code).toBe('B1');
    expect(p.progressToNextLevel).toBe(0);
    expect(p.nextLevel?.code).toBe('B2');
    expect(p.wordsToNextLevel).toBe(1500);
  });

  it('caps the top level (C2) at 100% with no next level', () => {
    const p = deriveCefrProgress(9000);
    expect(p.estimatedLevel.code).toBe('C2');
    expect(p.estimatedLevel.max).toBeNull();
    expect(p.progressToNextLevel).toBe(100);
    expect(p.nextLevel).toBeNull();
    expect(p.wordsToNextLevel).toBeNull();
  });
});
