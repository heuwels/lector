import { describe, it, expect } from 'vitest';
import {
  availableLanguages,
  normalizeEnabledLanguages,
  withLanguageDisabled,
  withLanguageEnabled,
} from './enabled';
import { LANGUAGES } from './registry';

// The opted-in language list (#442). One normalizer serves the picker, the
// settings page and the API, so order and membership cannot drift between them.
describe('normalizeEnabledLanguages', () => {
  it('drops unknown codes and non-strings', () => {
    expect(normalizeEnabledLanguages(['de', 'xx', 7, null, 'af'])).toEqual(['af', 'de']);
  });

  it('removes duplicates', () => {
    expect(normalizeEnabledLanguages(['de', 'de', 'de'])).toEqual(['de']);
  });

  it('returns registry order, not the caller order', () => {
    const codes = Object.keys(LANGUAGES);
    const reversed = [...codes].reverse();
    expect(normalizeEnabledLanguages(reversed)).toEqual(codes);
  });

  it('returns an empty list for an empty input', () => {
    expect(normalizeEnabledLanguages([])).toEqual([]);
  });
});

describe('withLanguageEnabled', () => {
  it('adds a language in registry order', () => {
    expect(withLanguageEnabled(['de'], 'af')).toEqual(['af', 'de']);
  });

  it('adding a listed language changes nothing', () => {
    expect(withLanguageEnabled(['af', 'de'], 'de')).toEqual(['af', 'de']);
  });
});

describe('withLanguageDisabled', () => {
  it('removes the language', () => {
    expect(withLanguageDisabled(['af', 'de'], 'de')).toEqual(['af']);
  });

  it('removing an unlisted language changes nothing', () => {
    expect(withLanguageDisabled(['af'], 'de')).toEqual(['af']);
  });

  it('can empty the list', () => {
    expect(withLanguageDisabled(['af'], 'af')).toEqual([]);
  });
});

describe('availableLanguages', () => {
  it('returns every registry language that is not listed', () => {
    const available = availableLanguages(['af']);
    expect(available).not.toContain('af');
    expect(available).toHaveLength(Object.keys(LANGUAGES).length - 1);
    expect(available).toEqual(Object.keys(LANGUAGES).filter((code) => code !== 'af'));
  });

  it('returns nothing when every language is listed', () => {
    expect(availableLanguages(Object.keys(LANGUAGES))).toEqual([]);
  });

  it('ignores unknown stored codes', () => {
    expect(availableLanguages(['xx'])).toEqual(Object.keys(LANGUAGES));
  });
});
