import { describe, test, expect } from 'bun:test';
import {
  ankiCardToState,
  buildClozeText,
  highlightWordHtml,
  splitTrailingPunctuation,
  stateRank,
} from './anki';

// Server-side mirrors of the pure client helpers (src/lib/anki.ts /
// src/lib/words.ts) — keep both sides' behaviour locked together (#241).

describe('ankiCardToState', () => {
  test('maps card type + interval to lector states', () => {
    expect(ankiCardToState(0, 0)).toBeNull(); // New — no signal
    expect(ankiCardToState(1, 0)).toBe('level1'); // Learning
    expect(ankiCardToState(3, 5)).toBe('level2'); // Relearning
    expect(ankiCardToState(2, 20)).toBe('level4'); // Young review
    expect(ankiCardToState(2, 21)).toBe('known'); // Mature review
  });

  test('rank keeps ignored un-overridable', () => {
    expect(stateRank('ignored')).toBe(stateRank('known'));
    expect(stateRank('level4')).toBeLessThan(stateRank('known'));
  });
});

describe('buildClozeText', () => {
  test('blanks whole-word matches only', () => {
    expect(buildClozeText('Die huis is groot.', 'huis')).toBe('Die {{c1::huis}} is groot.');
    expect(buildClozeText('Die huisie is klein.', 'huis')).toBe('Die huisie is klein.');
  });

  test('strips trailing punctuation from bank words (#68, #108)', () => {
    expect(buildClozeText('Ek sien haar nou.', 'haar.')).toBe('Ek sien {{c1::haar}} nou.');
  });

  test('unicode boundaries: no blanking inside diacritic words (#289)', () => {
    expect(buildClozeText('Die Häuser is mooi.', 'Häuser')).toBe('Die {{c1::Häuser}} is mooi.');
    expect(buildClozeText('ähnlich äußern', 'äußern')).toBe('ähnlich {{c1::äußern}}');
  });
});

describe('highlightWordHtml', () => {
  test('bolds every whole-word occurrence, case-insensitively', () => {
    expect(highlightWordHtml('Huis en huis.', 'huis')).toBe('<b>Huis</b> en <b>huis</b>.');
  });
});

describe('splitTrailingPunctuation', () => {
  test('splits trailing punctuation and strips leading quotes', () => {
    expect(splitTrailingPunctuation('haar.')).toEqual(['haar', '.']);
    expect(splitTrailingPunctuation('„Sind')).toEqual(['Sind', '']);
    expect(splitTrailingPunctuation("'n")).toEqual(["'n", '']);
  });
});
