import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createBlankedSentence,
  normalize,
  checkAnswer,
  getFuzzyStatus,
  calculateNextReview,
  calculatePoints,
  generateDistractors,
  shuffle,
} from '../utils';
import type { ClozeSentence } from '@/types';

function makeSentence(clozeWord: string): ClozeSentence {
  return { clozeWord } as ClozeSentence;
}

describe('normalize', () => {
  it('lowercases and trims', () => {
    expect(normalize('  Huis ')).toBe('huis');
  });

  it('strips punctuation', () => {
    expect(normalize('huis.')).toBe('huis');
    expect(normalize('reg?!')).toBe('reg');
    expect(normalize("'n")).toBe('n');
  });

  it('keeps diacritics', () => {
    expect(normalize('Sê!')).toBe('sê');
  });
});

describe('checkAnswer', () => {
  it('matches regardless of case and punctuation', () => {
    expect(checkAnswer('huis', 'Huis.')).toBe(true);
    expect(checkAnswer('HUIS', 'huis')).toBe(true);
  });

  it('rejects different words', () => {
    expect(checkAnswer('huis', 'muis')).toBe(false);
  });

  it('does not treat a prefix as correct', () => {
    expect(checkAnswer('hui', 'huis')).toBe(false);
  });

  it('distinguishes diacritics', () => {
    expect(checkAnswer('se', 'sê')).toBe(false);
  });
});

describe('createBlankedSentence', () => {
  it('blanks a mid-sentence word', () => {
    expect(createBlankedSentence('Die kat sit op die mat.', 1)).toBe('Die _____ sit op die mat.');
  });

  it('keeps trailing punctuation outside the blank at sentence end', () => {
    expect(createBlankedSentence('Die kat sit op die mat.', 5)).toBe('Die kat sit op die _____.');
    expect(createBlankedSentence('Het jy my kos?', 3)).toBe('Het jy my _____?');
  });

  it('blanks a word with no attached punctuation', () => {
    expect(createBlankedSentence('Ons stap saam', 2)).toBe('Ons stap _____');
  });
});

describe('getFuzzyStatus', () => {
  it('is empty for blank or whitespace input', () => {
    expect(getFuzzyStatus('', 'huis')).toBe('empty');
    expect(getFuzzyStatus('   ', 'huis')).toBe('empty');
  });

  it('matches case- and punctuation-insensitively', () => {
    expect(getFuzzyStatus('Huis', 'huis.')).toBe('match');
  });

  it('is partial for a correct prefix', () => {
    expect(getFuzzyStatus('hu', 'huis')).toBe('partial');
  });

  it('is wrong for a bad prefix or overlong input', () => {
    expect(getFuzzyStatus('mu', 'huis')).toBe('wrong');
    expect(getFuzzyStatus('huise', 'huis')).toBe('wrong');
  });
});

describe('calculateNextReview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const DAY = 24 * 60 * 60 * 1000;

  it('schedules at the exact review time per mastery level', () => {
    const now = Date.now();
    expect(calculateNextReview(0).getTime()).toBe(now);
    expect(calculateNextReview(25).getTime()).toBe(now + 1 * DAY);
    expect(calculateNextReview(50).getTime()).toBe(now + 3 * DAY);
    expect(calculateNextReview(75).getTime()).toBe(now + 7 * DAY);
    expect(calculateNextReview(100).getTime()).toBe(now + 14 * DAY);
  });
});

describe('calculatePoints', () => {
  it('awards more points at higher mastery', () => {
    expect(calculatePoints(0)).toBe(10);
    expect(calculatePoints(25)).toBe(15);
    expect(calculatePoints(50)).toBe(20);
    expect(calculatePoints(75)).toBe(25);
    expect(calculatePoints(100)).toBe(30);
  });
});

describe('generateDistractors', () => {
  it('returns at most three distractors', () => {
    const pool = ['een', 'twee', 'drie', 'vier', 'vyf'].map(makeSentence);
    expect(generateDistractors('huis', pool).length).toBe(3);
  });

  it('never includes the correct word, even with different punctuation or case', () => {
    const pool = ['Huis.', 'muis', 'tuis'].map(makeSentence);
    const result = generateDistractors('huis', pool);
    expect(result.map(normalize)).not.toContain('huis');
  });

  it('deduplicates words that normalize identically', () => {
    const pool = ['muis', 'Muis.', 'muis!', 'tuis'].map(makeSentence);
    const result = generateDistractors('huis', pool);
    expect(result.map(normalize).sort()).toEqual(['muis', 'tuis']);
  });

  it('prefers length-similar candidates when the pool is large', () => {
    const similar = Array.from({ length: 12 }, (_, i) => `word${String(i).padStart(2, '0')}`); // 6 chars
    const farOff = ['a', 'ab', 'abcdefghijklmnop'];
    const pool = [...farOff, ...similar].map(makeSentence);
    const result = generateDistractors('sescha', pool); // 6 chars
    for (const distractor of result) {
      expect(similar).toContain(distractor);
    }
  });

  it('returns fewer distractors when the pool is small', () => {
    expect(generateDistractors('huis', [makeSentence('muis')])).toEqual(['muis']);
    expect(generateDistractors('huis', [])).toEqual([]);
  });
});

describe('shuffle', () => {
  it('preserves length and elements', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = shuffle(input);
    expect(result).toHaveLength(input.length);
    expect([...result].sort((a, b) => a - b)).toEqual(input);
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3];
    const copy = [...input];
    shuffle(input);
    expect(input).toEqual(copy);
  });
});
