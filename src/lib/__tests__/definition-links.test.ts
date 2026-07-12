import { describe, test, expect } from 'vitest';
import { findNestedWordRef } from '../definition-links';

describe('findNestedWordRef — form-of glosses linkify', () => {
  test('plural of (the issue #106 example)', () => {
    expect(findNestedWordRef('plural of vrug')).toEqual({
      prefix: 'plural of ',
      word: 'vrug',
      suffix: '',
    });
  });

  test('past participle of', () => {
    expect(findNestedWordRef('past participle of breek')?.word).toBe('breek');
  });

  test('attributive form of', () => {
    expect(findNestedWordRef('attributive form of Afrikaanstalig')?.word).toBe('Afrikaanstalig');
  });

  test('alternative spelling of', () => {
    expect(findNestedWordRef('alternative spelling of bod')?.word).toBe('bod');
  });

  test('diminutive of, with leading commentary', () => {
    expect(findNestedWordRef('a male given name: diminutive of Jacob')?.word).toBe('Jacob');
  });

  test('synonym of', () => {
    expect(findNestedWordRef('synonym of seleen (“selenium”)')?.word).toBe('seleen');
  });

  test('comparative/superlative degree of', () => {
    expect(findNestedWordRef('superlative degree of geel')?.word).toBe('geel');
    expect(findNestedWordRef('independent plural comparative of dig')?.word).toBe('dig');
  });

  test('contraction, clipping, preterite, misspelling of', () => {
    expect(findNestedWordRef('contraction of dit is')).toBeNull(); // multi-word target
    expect(findNestedWordRef('clipping of limousine')?.word).toBe('limousine');
    expect(findNestedWordRef('preterite of kan; could')?.word).toBe('kan');
    expect(findNestedWordRef('misspelling of asseblief')?.word).toBe('asseblief');
  });

  test('present of (sparse modal glosses)', () => {
    expect(findNestedWordRef('present of hê')?.word).toBe('hê');
  });
});

describe('findNestedWordRef — segmentation and punctuation', () => {
  test('uses the last form-of phrase when several appear', () => {
    const ref = findNestedWordRef(
      'am, are, is (present tense, all persons, plural and singular of wees, to be)',
    );
    expect(ref?.word).toBe('wees');
    expect(ref?.suffix).toBe(', to be)');
  });

  test('cuts commentary at semicolons and parens', () => {
    expect(findNestedWordRef('past participle of wees; been')?.word).toBe('wees');
    expect(findNestedWordRef('plural of saal (hall)')?.word).toBe('saal');
  });

  test('cuts at colon', () => {
    expect(findNestedWordRef('partitive form of ander: else, other, different')?.word).toBe('ander');
  });

  test('strips trailing sentence punctuation from the word', () => {
    const ref = findNestedWordRef('plural of vrug.');
    expect(ref?.word).toBe('vrug');
    expect(ref?.suffix).toBe('.');
  });

  test('prefix + word + suffix reassemble the original gloss', () => {
    const gloss = 'past participle of wees; been';
    const ref = findNestedWordRef(gloss)!;
    expect(ref.prefix + ref.word + ref.suffix).toBe(gloss);
  });

  test('keeps Afrikaans diacritics and hyphens in the word', () => {
    expect(findNestedWordRef('preterite of hê; had')?.word).toBe('hê');
    expect(findNestedWordRef('alternative form of agt-en-negentigste')?.word).toBe('agt-en-negentigste');
    expect(findNestedWordRef('plural of Algeriër')?.word).toBe('Algeriër');
  });

  test('keyword match is case-insensitive', () => {
    expect(findNestedWordRef('Plural of vrug')?.word).toBe('vrug');
  });
});

describe('findNestedWordRef — ordinary English "of" must not linkify', () => {
  test.each([
    'pound (unit of weight)',
    'fear of heights',
    'A pair of scissors',
    'person from Belarus or of Belarusian descent',
    'Tripoli (the capital city of Libya)',
    'cloud of smoke',
    'made out of wood',
    'letter (letter of the alphabet)',
    'some of (the)',
    'Any of various small chillies',
  ])('%s', (gloss) => {
    expect(findNestedWordRef(gloss)).toBeNull();
  });

  test('multi-word targets are skipped rather than guessed', () => {
    expect(
      findNestedWordRef('initialism of belasting op toegevoegde waarde; VAT, value-added tax'),
    ).toBeNull();
    expect(findNestedWordRef('initialism of National Party')).toBeNull();
    expect(
      findNestedWordRef('Optionally forms the perfect tense of the verbs wees (“be”), trou (“marry”).'),
    ).toBeNull();
  });

  test('non-Latin targets linkify (#289 — dictionaries are no longer Latin-only)', () => {
    // Pre-#289 these were skipped as "not a useful lookup target"; with
    // Cyrillic/Greek/Arabic/Hebrew packs on the roadmap a form-of reference
    // in any script is a legitimate nested lookup.
    expect(findNestedWordRef('Arabic spelling of داک')?.word).toBe('داک');
    expect(findNestedWordRef('plural of слово')?.word).toBe('слово');
    // Digits and other non-letter junk still don't linkify.
    expect(findNestedWordRef('abbreviation of 1999')).toBeNull();
  });

  test('empty and dangling-of glosses', () => {
    expect(findNestedWordRef('')).toBeNull();
    expect(findNestedWordRef('plural of')).toBeNull();
    expect(findNestedWordRef('plural of ')).toBeNull();
  });
});
