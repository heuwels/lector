import { describe, it, expect } from 'vitest';
import { splitTrailingPunctuation, sentenceContainsWord } from '../words';
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

  it('strips leading quotes/brackets (German „, parens) but not the apostrophe', () => {
    expect(splitTrailingPunctuation('„Sind')[0]).toBe('Sind');
    expect(splitTrailingPunctuation('(Haus)')[0]).toBe('Haus');
    expect(splitTrailingPunctuation("'n")[0]).toBe("'n");
  });
});

describe('sentenceContainsWord', () => {
  it('finds a word that appears as a token', () => {
    expect(sentenceContainsWord('Die vrugte is baie lekker.', 'vrugte')).toBe(true);
  });

  it('is case-insensitive both ways', () => {
    expect(sentenceContainsWord('Vrugte is lekker.', 'vrugte')).toBe(true);
    expect(sentenceContainsWord('die vrugte is lekker', 'Vrugte')).toBe(true);
  });

  it('rejects substring hits — sien is not in gesien (issue #106)', () => {
    expect(sentenceContainsWord('Ek het die katte gesien.', 'sien')).toBe(false);
    expect(sentenceContainsWord('Die vrugte is baie lekker.', 'vrug')).toBe(false);
  });

  it('matches through surrounding punctuation', () => {
    expect(sentenceContainsWord('Hy sê: "vrugte!"', 'vrugte')).toBe(true);
    expect(sentenceContainsWord('Die kat, die hond en die vis.', 'hond')).toBe(true);
  });

  it('keeps hyphenated words and diacritics intact', () => {
    expect(sentenceContainsWord('Ons gaan na die Klein-Karoo toe.', 'Klein-Karoo')).toBe(true);
    expect(sentenceContainsWord('Ons gaan na die Klein-Karoo toe.', 'Karoo')).toBe(false);
    expect(sentenceContainsWord('Wat sê jy?', 'sê')).toBe(true);
  });

  it('handles curly-quote wrapping', () => {
    expect(sentenceContainsWord('Hy skryf ‘vrug’ neer.', 'vrug')).toBe(true);
  });

  it('handles empty inputs', () => {
    expect(sentenceContainsWord('', 'vrug')).toBe(false);
    expect(sentenceContainsWord('Die vrugte is lekker.', '')).toBe(false);
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
