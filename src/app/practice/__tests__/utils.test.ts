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

  it('strips German and curly quotes', () => {
    expect(normalize('„Sind')).toBe('sind');
    expect(normalize('„Ja“')).toBe('ja');
  });

  it('strips Spanish inverted question/exclamation marks', () => {
    expect(normalize('¿Cómo')).toBe('cómo');
    expect(normalize('¡Hola!')).toBe('hola');
  });

  it('keeps French diacritics and strips guillemets', () => {
    expect(normalize('Café')).toBe('café');
    expect(normalize('« Français »')).toBe('français');
    expect(normalize('être…')).toBe('être');
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

  it('matches when the bank word carries a leading German quote (#203)', () => {
    expect(checkAnswer('Sind', '„Sind')).toBe(true);
    expect(checkAnswer('sind', '„Sind')).toBe(true);
  });

  it('matches when the bank word carries a leading Spanish ¿/¡ mark', () => {
    expect(checkAnswer('Cómo', '¿Cómo')).toBe(true);
    expect(checkAnswer('ni', '¡Ni')).toBe(true);
  });

  it('matches French content words through case and punctuation', () => {
    expect(checkAnswer('eau', 'eau,')).toBe(true);
    expect(checkAnswer('Français', 'français')).toBe(true);
  });

  it('distinguishes French diacritics (a vs à, e vs é)', () => {
    expect(checkAnswer('a', 'à')).toBe(false);
    expect(checkAnswer('ecole', 'école')).toBe(false);
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
  it('scales with the mastery reached: base × (mastery ÷ 25)', () => {
    // Typed answers use base 8.
    expect(calculatePoints(0, 0, 4, 'type')).toBe(0);
    expect(calculatePoints(25, 0, 4, 'type')).toBe(8);
    expect(calculatePoints(50, 0, 4, 'type')).toBe(16);
    expect(calculatePoints(75, 0, 4, 'type')).toBe(24);
    expect(calculatePoints(100, 0, 4, 'type')).toBe(32);
  });

  it('awards half as much for multiple choice (base 4 vs 8)', () => {
    expect(calculatePoints(25, 0, 4, 'mc')).toBe(4);
    expect(calculatePoints(50, 0, 4, 'mc')).toBe(8);
    expect(calculatePoints(75, 0, 4, 'mc')).toBe(12);
    expect(calculatePoints(100, 0, 4, 'mc')).toBe(16);
  });

  it('deducts points for each letter revealed via hints (typed answers)', () => {
    // 4-letter word at mastery 100 (base 8 × 4 = 32): each hint reveals 25%.
    expect(calculatePoints(100, 0, 4, 'type')).toBe(32);
    expect(calculatePoints(100, 1, 4, 'type')).toBe(24); // 32 * 3/4
    expect(calculatePoints(100, 2, 4, 'type')).toBe(16); // 32 * 2/4
    expect(calculatePoints(100, 3, 4, 'type')).toBe(8); // 32 * 1/4
    expect(calculatePoints(100, 4, 4, 'type')).toBe(0); // whole word revealed
  });

  it('scales the discount to the fraction revealed, not the absolute hint count', () => {
    // One hint is worth less on a long word than on a short one (mastery 100 → 32).
    expect(calculatePoints(100, 1, 2, 'type')).toBe(16); // revealed 1/2 -> 32 * 0.5
    expect(calculatePoints(100, 1, 4, 'type')).toBe(24); // revealed 1/4 -> 32 * 0.75
    expect(calculatePoints(100, 1, 8, 'type')).toBe(28); // revealed 1/8 -> 32 * 0.875
  });

  it('awards zero once the entire word has been revealed', () => {
    expect(calculatePoints(25, 3, 3, 'type')).toBe(0);
    expect(calculatePoints(50, 5, 5, 'type')).toBe(0);
    expect(calculatePoints(100, 7, 7, 'type')).toBe(0);
  });

  it('never returns negative points when more letters are revealed than the word has', () => {
    expect(calculatePoints(100, 10, 4, 'type')).toBe(0);
    expect(calculatePoints(25, 8, 4, 'type')).toBe(0);
  });

  it('always returns whole-number, non-negative points across both modes', () => {
    for (const mode of ['type', 'mc'] as const) {
      for (const mastery of [0, 25, 50, 75, 100] as const) {
        for (let hints = 0; hints <= 5; hints++) {
          const points = calculatePoints(mastery, hints, 4, mode);
          expect(Number.isInteger(points)).toBe(true);
          expect(points).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('applies no discount for a zero-length word (guards divide-by-zero)', () => {
    expect(calculatePoints(100, 1, 0, 'type')).toBe(32);
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
