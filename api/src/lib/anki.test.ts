import { describe, test, expect } from 'bun:test';
import {
  ankiCardToState,
  buildClozeText,
  buildSourceLinkHtml,
  formatClipTimestamp,
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

describe('buildSourceLinkHtml (#334)', () => {
  test('links to the start timestamp and labels start–end', () => {
    expect(
      buildSourceLinkHtml({
        sourceUrl: 'https://www.youtube.com/watch?v=abc',
        clipStartMs: 72000,
        clipEndMs: 78000,
      }),
    ).toBe('<a href="https://www.youtube.com/watch?v=abc&amp;t=72s">▶ 1:12–1:18</a>');
  });

  test('escapes the href and rejects non-http(s) / empty URLs', () => {
    expect(buildSourceLinkHtml({ sourceUrl: '', clipStartMs: 0, clipEndMs: 1 })).toBe('');
    expect(
      buildSourceLinkHtml({ sourceUrl: 'javascript:alert(1)', clipStartMs: 0, clipEndMs: 1 }),
    ).toBe('');
    // A crafted query value can't break out of the href attribute: URL
    // serialization percent-encodes the quote/brackets before the anchor is
    // built, so no raw injection survives.
    const html = buildSourceLinkHtml({
      sourceUrl: 'https://x.test/watch?a="><b>',
      clipStartMs: null,
      clipEndMs: null,
    });
    expect(html).not.toContain('"><b>');
    expect(html).toContain('%22');
    expect(html.startsWith('<a href="https://x.test/watch?')).toBe(true);
  });

  test('formatClipTimestamp', () => {
    expect(formatClipTimestamp(9000)).toBe('0:09');
    expect(formatClipTimestamp(3661000)).toBe('1:01:01');
  });
});
