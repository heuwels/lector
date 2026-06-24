import { describe, it, expect } from 'vitest';
import { diffDictation, scoreDictation, calculateDictationPoints } from '../utils';
import { DICTATION_PASS_THRESHOLD, DICTATION_POINTS_BASE } from '../constants';
import type { ClozeMasteryLevel } from '@/types';

describe('diffDictation', () => {
  it('marks an exact transcription fully correct', () => {
    const diff = diffDictation('die kat sit', 'die kat sit');
    expect(diff.correctWords).toBe(3);
    expect(diff.totalWords).toBe(3);
    expect(diff.accuracy).toBe(1);
    expect(diff.expected.every((w) => w.status === 'correct')).toBe(true);
    expect(diff.typed.every((w) => w.status === 'correct')).toBe(true);
  });

  it('ignores case and punctuation', () => {
    const diff = diffDictation('  Die KAT, sit! ', 'die kat sit');
    expect(diff.accuracy).toBe(1);
    expect(diff.correctWords).toBe(3);
    // Original spelling/casing is preserved for display.
    expect(diff.typed.map((w) => w.text)).toEqual(['Die', 'KAT,', 'sit!']);
  });

  it('flags a substituted word as wrong on the typed side and missing on the actual side', () => {
    const diff = diffDictation('die hond sit', 'die kat sit');
    expect(diff.correctWords).toBe(2);
    expect(diff.totalWords).toBe(3);
    expect(diff.accuracy).toBeCloseTo(2 / 3);

    const typedStatuses = diff.typed.map((w) => `${w.text}:${w.status}`);
    expect(typedStatuses).toEqual(['die:correct', 'hond:wrong', 'sit:correct']);

    const expectedStatuses = diff.expected.map((w) => `${w.text}:${w.status}`);
    expect(expectedStatuses).toEqual(['die:correct', 'kat:missing', 'sit:correct']);
  });

  it('handles a dropped word (omission)', () => {
    const diff = diffDictation('die sit', 'die kat sit');
    expect(diff.correctWords).toBe(2);
    expect(diff.totalWords).toBe(3);
    expect(diff.expected.find((w) => w.text === 'kat')?.status).toBe('missing');
  });

  it('counts every actual word correct but flags an inserted extra word', () => {
    const diff = diffDictation('die mooi kat sit', 'die kat sit');
    // All three actual words appear in order → accuracy is full…
    expect(diff.correctWords).toBe(3);
    expect(diff.accuracy).toBe(1);
    // …but the spurious "mooi" is flagged wrong, so it isn't a *perfect* match.
    expect(diff.typed.find((w) => w.text === 'mooi')?.status).toBe('wrong');
    expect(scoreDictation(diff).isPerfect).toBe(false);
  });

  it('does not cascade after a reordering (LCS alignment)', () => {
    const diff = diffDictation('kat die sit', 'die kat sit');
    // LCS of [kat,die,sit] vs [die,kat,sit] keeps "sit" plus one of die/kat.
    expect(diff.correctWords).toBe(2);
    expect(diff.totalWords).toBe(3);
  });

  it('scores empty input as zero with everything missing', () => {
    const diff = diffDictation('   ', 'die kat sit');
    expect(diff.correctWords).toBe(0);
    expect(diff.accuracy).toBe(0);
    expect(diff.typed).toHaveLength(0);
    expect(diff.expected.every((w) => w.status === 'missing')).toBe(true);
  });

  it('scores entirely wrong input as zero accuracy', () => {
    const diff = diffDictation('foo bar baz', 'die kat sit');
    expect(diff.correctWords).toBe(0);
    expect(diff.accuracy).toBe(0);
  });
});

describe('scoreDictation', () => {
  it('passes and marks perfect on an exact match', () => {
    const { isPass, isPerfect } = scoreDictation(diffDictation('die kat sit', 'die kat sit'));
    expect(isPass).toBe(true);
    expect(isPerfect).toBe(true);
  });

  it('passes but is not perfect when an extra word is typed', () => {
    const { isPass, isPerfect } = scoreDictation(diffDictation('die kat sit nou', 'die kat sit'));
    expect(isPass).toBe(true);
    expect(isPerfect).toBe(false);
  });

  it('passes at exactly the threshold', () => {
    // 3 of 4 words correct = 0.75, which is the pass threshold.
    const diff = diffDictation('ek het dit gedoen', 'ek het dit verloor');
    expect(diff.accuracy).toBeCloseTo(0.75);
    expect(diff.accuracy).toBeGreaterThanOrEqual(DICTATION_PASS_THRESHOLD);
    expect(scoreDictation(diff).isPass).toBe(true);
  });

  it('fails below the threshold', () => {
    // 2 of 4 words correct = 0.5, below the threshold → reset.
    const diff = diffDictation('ek het foo bar', 'ek het dit verloor');
    expect(diff.accuracy).toBeLessThan(DICTATION_PASS_THRESHOLD);
    expect(scoreDictation(diff).isPass).toBe(false);
    expect(scoreDictation(diff).isPerfect).toBe(false);
  });

  it('fails empty input', () => {
    const { isPass, isPerfect } = scoreDictation(diffDictation('', 'die kat sit'));
    expect(isPass).toBe(false);
    expect(isPerfect).toBe(false);
  });
});

describe('calculateDictationPoints', () => {
  it('awards base points for a perfect first pass (mastery 25)', () => {
    expect(calculateDictationPoints(25, 1)).toBe(DICTATION_POINTS_BASE);
  });

  it('scales points up with the mastery reached', () => {
    expect(calculateDictationPoints(100, 1)).toBe(DICTATION_POINTS_BASE * 4);
  });

  it('scales points down with accuracy (partial credit for minor errors)', () => {
    // 12 * (25/25) * 0.8 = 9.6 → 10
    expect(calculateDictationPoints(25, 0.8)).toBe(10);
    expect(calculateDictationPoints(25, 0.8)).toBeLessThan(calculateDictationPoints(25, 1));
  });

  it('awards nothing at mastery 0 (a failed attempt)', () => {
    expect(calculateDictationPoints(0 as ClozeMasteryLevel, 0)).toBe(0);
  });
});
