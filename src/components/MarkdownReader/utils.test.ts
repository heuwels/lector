import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import {
  splitWords,
  collectWords,
  computePhraseHighlightSet,
  parseSegmentWords,
  readableText,
  wordSpansBetween,
} from './utils';
import { LANGUAGES } from '@/lib/languages';

const af = LANGUAGES.af;
const de = LANGUAGES.de;

const words = (text: string, pack = af) =>
  splitWords(text, pack)
    .filter((p) => p.isWord)
    .map((p) => p.text);

describe('splitWords', () => {
  it('extracts words and leaves punctuation/whitespace as non-word parts', () => {
    expect(words('Die son sak agter die berge.')).toEqual([
      'Die',
      'son',
      'sak',
      'agter',
      'die',
      'berge',
    ]);
  });

  it('is lossless — joining all parts reconstructs the input', () => {
    const input = 'Sy dink: "wat nou?" en stap weg.';
    expect(
      splitWords(input, af)
        .map((p) => p.text)
        .join(''),
    ).toBe(input);
  });

  it('keeps hyphenated and accented words whole', () => {
    expect(words('Reen bring verligting vir die Wes-Kaap')).toContain('Wes-Kaap');
    expect(words('more is donker en moeilik')).toEqual(['more', 'is', 'donker', 'en', 'moeilik']);
  });

  it('treats the Afrikaans n-article as one word across apostrophe variants', () => {
    // straight ', curly (U+2018 / U+2019 — what the EPUB/HTML importer emits),
    // and modifier (U+02BC) all count as the n-article's apostrophe.
    for (const code of [0x27, 0x2018, 0x2019, 0x02bc]) {
      const apos = String.fromCharCode(code);
      expect(words(`${apos}n hond`)).toEqual([`${apos}n`, 'hond']);
    }
  });

  it('keeps German words with umlauts and ß whole (issue #203 §7d)', () => {
    // Before the À-ÖØ-öø-ž charset fix these shattered: Häuser→H+user, Straßen→Stra+en.
    expect(words('Die Häuser sind schöner geworden', de)).toEqual([
      'Die',
      'Häuser',
      'sind',
      'schöner',
      'geworden',
    ]);
    expect(words('Kinder gingen durch die Straßen', de)).toContain('Straßen');
    // Capitalised umlaut-initial German nouns stay whole.
    expect(words('Ärzte essen Öl', de)).toEqual(['Ärzte', 'essen', 'Öl']);
  });
});

describe('collectWords', () => {
  it('flattens words across strings and inline elements in document order', () => {
    // "die son is **baie mooi** vandag" as react-markdown would pass it
    const children = ['die son is ', createElement('strong', { key: 's' }, 'baie mooi'), ' vandag'];
    expect(collectWords(children, af)).toEqual(['die', 'son', 'is', 'baie', 'mooi', 'vandag']);
  });

  it('recurses into nested inline elements', () => {
    const children = createElement('em', null, 'sag ', createElement('strong', null, 'wind'));
    expect(collectWords(children, af)).toEqual(['sag', 'wind']);
  });

  it('ignores non-text leaves', () => {
    expect(collectWords([null, false, undefined, 123, 'hond'], af)).toEqual(['hond']);
  });
});

describe('computePhraseHighlightSet', () => {
  const block = ['die', 'son', 'sak', 'die', 'bloue', 'berge'];

  it('marks the first contiguous run of the phrase', () => {
    expect([...computePhraseHighlightSet(block, ['sak', 'die'], af)]).toEqual([2, 3]);
  });

  it('is case-insensitive', () => {
    expect([...computePhraseHighlightSet(['Die', 'Son'], ['die', 'son'], af)]).toEqual([0, 1]);
  });

  it('returns empty for no match, empty phrase, or over-long phrase', () => {
    expect(computePhraseHighlightSet(block, ['kat'], af).size).toBe(0);
    expect(computePhraseHighlightSet(block, [], af).size).toBe(0);
    expect(computePhraseHighlightSet(['een'], ['een', 'twee'], af).size).toBe(0);
  });
});

describe('parseSegmentWords (#289 4.2)', () => {
  it('reads a stored list', () => {
    expect(parseSegmentWords('["喜欢","读书"]')).toEqual(['喜欢', '读书']);
  });

  it('treats absent, empty and blank as no segmentation', () => {
    expect(parseSegmentWords(null)).toBeNull();
    expect(parseSegmentWords(undefined)).toBeNull();
    expect(parseSegmentWords('')).toBeNull();
    expect(parseSegmentWords('[]')).toBeNull();
  });

  it('degrades to null on malformed input rather than throwing', () => {
    // The reader can always fall back to Intl.Segmenter, so one bad row must
    // never blank the page.
    expect(parseSegmentWords('{not json')).toBeNull();
    expect(parseSegmentWords('{"a":1}')).toBeNull();
    expect(parseSegmentWords('"a string"')).toBeNull();
  });

  it('drops non-string entries instead of rejecting the whole list', () => {
    expect(parseSegmentWords('["喜欢",7,null,"读书"]')).toEqual(['喜欢', '读书']);
  });
});

describe('readableText (#289 4.4)', () => {
  // The vitest environment is 'node', so these are DOM-shaped stubs exercising
  // the walk itself. Real browser behaviour is covered in e2e: with a live
  // <ruby>, `textContent` gives "我wǒ喜欢xǐhuan" where this returns "我喜欢".
  const text = (value: string): Node => ({ nodeType: 3, textContent: value }) as unknown as Node;
  const el = (tagName: string, ...children: Node[]): Node =>
    ({ nodeType: 1, tagName, childNodes: children }) as unknown as Node;
  const ruby = (base: string, reading: string) => el('RUBY', text(base), el('RT', text(reading)));

  it('skips the reading and keeps the base text', () => {
    expect(readableText(ruby('喜欢', 'xǐhuan'))).toBe('喜欢');
  });

  it('reassembles a whole block without any annotation', () => {
    const block = el(
      'P',
      el('SPAN', ruby('我', 'wǒ')),
      el('SPAN', ruby('喜欢', 'xǐhuan')),
      el('SPAN', ruby('读书', 'dúshū')),
      el('SPAN', text('。')),
    );
    expect(readableText(block)).toBe('我喜欢读书。');
  });

  it('skips <rp> too, which is the non-ruby fallback parenthesis', () => {
    const withFallback = el(
      'RUBY',
      text('日本語'),
      el('RP', text('(')),
      el('RT', text('にほんご')),
      el('RP', text(')')),
    );
    expect(readableText(withFallback)).toBe('日本語');
  });

  it('leaves un-annotated markup untouched, including nested inline elements', () => {
    const block = el('P', text('Die '), el('STRONG', text('groot')), text(' hond.'));
    expect(readableText(block)).toBe('Die groot hond.');
  });

  it('returns a bare text node as itself', () => {
    expect(readableText(text('hallo'))).toBe('hallo');
  });

  it('returns empty for an annotation asked about directly', () => {
    expect(readableText(el('RT', text('wǒ')))).toBe('');
  });
});

describe('wordSpansBetween', () => {
  const spans = ['die', 'groot', 'hond', 'loop'];

  it('returns the inclusive run for a forward drag', () => {
    expect(wordSpansBetween('die', 'hond', spans)).toEqual(['die', 'groot', 'hond']);
  });

  it('returns the same run for a backward drag', () => {
    expect(wordSpansBetween('hond', 'die', spans)).toEqual(['die', 'groot', 'hond']);
  });

  it('returns the single word when both endpoints are the same', () => {
    expect(wordSpansBetween('groot', 'groot', spans)).toEqual(['groot']);
  });

  it('returns nothing when an endpoint is not in the list', () => {
    expect(wordSpansBetween('die', 'kat', spans)).toEqual([]);
    expect(wordSpansBetween('kat', 'die', spans)).toEqual([]);
  });
});
