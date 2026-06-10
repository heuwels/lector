import { describe, it, expect } from 'vitest';
import { splitTrailingPunctuation } from '../words';
import { buildClozeText } from '../anki';

describe('splitTrailingPunctuation', () => {
  it('splits a single trailing mark', () => {
    expect(splitTrailingPunctuation('haar.')).toEqual(['haar', '.']);
    expect(splitTrailingPunctuation('sê!')).toEqual(['sê', '!']);
  });

  it('splits runs of trailing punctuation', () => {
    expect(splitTrailingPunctuation('word.,')).toEqual(['word', '.,']);
    expect(splitTrailingPunctuation('reg?"')).toEqual(['reg', '?"']);
  });

  it('returns clean words unchanged', () => {
    expect(splitTrailingPunctuation('hond')).toEqual(['hond', '']);
  });

  it("keeps the Afrikaans 'n contraction intact", () => {
    expect(splitTrailingPunctuation("'n")).toEqual(["'n", '']);
  });
});

describe('buildClozeText', () => {
  it('builds a cloze for a bank word with trailing punctuation (issue #108)', () => {
    // "gelees." as stored in the bank previously produced \bgelees\.\b, which
    // never matches — the note had no {{c1::}} and AnkiConnect rejected it.
    expect(buildClozeText('Hy het die boek gelees.', 'gelees.')).toBe(
      'Hy het die boek {{c1::gelees}}.'
    );
  });

  it('keeps punctuation outside the blank for mid-sentence words', () => {
    expect(buildClozeText('Sy het haar boek gelees.', 'haar.')).toBe(
      'Sy het {{c1::haar}} boek gelees.'
    );
  });

  it('preserves the original casing via the capture group', () => {
    expect(buildClozeText('Haar boek is hier.', 'haar.')).toBe('{{c1::Haar}} boek is hier.');
  });

  it('returns the sentence unchanged when the word is absent', () => {
    expect(buildClozeText('Geen ooreenkoms hier nie.', 'afwesig')).toBe(
      'Geen ooreenkoms hier nie.'
    );
  });
});
