import { describe, it, expect } from 'vitest';
import { graphemeSplit, graphemeLength, graphemeSlice } from './graphemes';

const COMBINING_ACUTE = String.fromCharCode(0x0301);

describe('graphemeLength', () => {
  it('matches .length for plain ASCII', () => {
    expect(graphemeLength('hallo')).toBe(5);
    expect(graphemeLength('')).toBe(0);
  });

  it('counts a base + combining mark as one character', () => {
    const decomposed = 'e' + COMBINING_ACUTE; // é as two code units
    expect(decomposed.length).toBe(2);
    expect(graphemeLength(decomposed)).toBe(1);
  });

  it('counts a non-BMP character (surrogate pair) as one', () => {
    const clef = String.fromCodePoint(0x1d11e); // 𝄞
    expect(clef.length).toBe(2);
    expect(graphemeLength(clef)).toBe(1);
  });

  it('counts pointed Hebrew by base letters, not marks', () => {
    // בָּ = bet + dagesh + qamats: 3 code units, 1 user-perceived character
    const pointed = 'בָּ';
    expect(pointed.length).toBe(3);
    expect(graphemeLength(pointed)).toBe(1);
  });
});

describe('graphemeSlice', () => {
  it('slices like String.slice for ASCII', () => {
    expect(graphemeSlice('hallo', 3)).toBe('hal');
  });

  it('never separates a base from its combining marks', () => {
    const word = 'e' + COMBINING_ACUTE + 'x'; // é + x
    expect(graphemeSlice(word, 1)).toBe('e' + COMBINING_ACUTE);
    expect(graphemeSlice(word, 2)).toBe(word);
  });

  it('never tears a surrogate pair', () => {
    const s = String.fromCodePoint(0x1d11e) + 'a';
    expect(graphemeSlice(s, 1)).toBe(String.fromCodePoint(0x1d11e));
  });

  it('clamps: 0 → empty, past the end → whole string', () => {
    expect(graphemeSlice('abc', 0)).toBe('');
    expect(graphemeSlice('abc', 99)).toBe('abc');
  });
});

describe('graphemeSplit', () => {
  it('splits into user-perceived characters', () => {
    const word = 'se' + String.fromCharCode(0x0302); // s + decomposed ê
    expect(graphemeSplit(word)).toEqual(['s', 'e' + String.fromCharCode(0x0302)]);
  });
});
