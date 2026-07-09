import { describe, it, expect } from 'vitest';
import { normalizeText, foldWord } from './text';
import { LANGUAGES } from './registry';
import type { LanguageConfig } from './types';

const af = LANGUAGES.af;
const de = LANGUAGES.de;

// Synthetic caseless pack (ar-shaped) — no registered pack is caseless yet;
// this is exactly how the #253/#255 packs will configure it.
const caseless: LanguageConfig = {
  ...af,
  script: { bcp47: 'ar', direction: 'rtl', kind: 'alpha-spaced', hasCase: false },
};

const COMBINING_CIRCUMFLEX = String.fromCharCode(0x0302);

describe('normalizeText', () => {
  it('composes decomposed sequences to NFC', () => {
    const decomposed = 'se' + COMBINING_CIRCUMFLEX;
    expect(decomposed).toHaveLength(3);
    expect(normalizeText(decomposed)).toBe('sê');
    expect(normalizeText(decomposed)).toHaveLength(2);
  });

  it('strips soft hyphens, zero-width spaces, word joiners and BOMs', () => {
    expect(normalizeText('Wo­rt')).toBe('Wort'); // soft hyphen (EPUBs)
    expect(normalizeText('﻿hallo')).toBe('hallo'); // BOM
    expect(normalizeText('een​twee')).toBe('eentwee'); // zero-width space
    expect(normalizeText('a⁠b')).toBe('ab'); // word joiner
  });

  it('keeps ZWNJ/ZWJ and directional marks (orthographic / bidi-meaningful)', () => {
    expect(normalizeText('a‌b')).toBe('a‌b'); // ZWNJ
    expect(normalizeText('a‍b')).toBe('a‍b'); // ZWJ
    expect(normalizeText('a‎b')).toBe('a‎b'); // LRM
  });

  it('folds the polytonic Greek oxia duplicates to tonos', () => {
    // U+1F71 (alpha + oxia) and U+03AC (alpha + tonos) render identically and
    // both appear in real polytonic text — NFC maps the first to the second,
    // which is the classic Greek vocab-key gotcha (#254).
    expect(normalizeText('ά')).toBe('ά');
  });

  it('composes Korean jamo to syllables (NFD input is otherwise fatal, #258)', () => {
    expect(normalizeText('한')).toBe('한'); // 한
  });

  it('is a no-op on already-NFC text', () => {
    const text = 'Die Häuser wurden sê môre gebaut.';
    expect(normalizeText(text)).toBe(text);
  });
});

describe('foldWord', () => {
  it('is NFC + lowercase for cased scripts (byte-identical to the old keying)', () => {
    expect(foldWord('Häuser', de)).toBe('häuser');
    expect(foldWord('VRUGTE', af)).toBe('vrugte');
    expect(foldWord('môre', af)).toBe('môre');
  });

  it('folds decomposed input onto the same key as precomposed', () => {
    const decomposed = 'SE' + COMBINING_CIRCUMFLEX;
    expect(foldWord(decomposed, af)).toBe(foldWord('sê', af));
  });

  it('drops soft hyphens from keys', () => {
    expect(foldWord('Häu­ser', de)).toBe('häuser');
  });

  it('skips lowercasing for caseless scripts', () => {
    const word = 'كتاب';
    expect(foldWord(word, caseless)).toBe(word);
  });

  it('folds Cyrillic and Greek case, which SQLite LOWER() cannot', () => {
    const ru: LanguageConfig = {
      ...af,
      script: { bcp47: 'ru', direction: 'ltr', kind: 'alpha-spaced', hasCase: true },
    };
    expect(foldWord('Привет', ru)).toBe('привет');
    const grc: LanguageConfig = {
      ...af,
      script: { bcp47: 'grc', direction: 'ltr', kind: 'alpha-spaced', hasCase: true },
    };
    expect(foldWord('Λόγος', grc)).toBe('λόγος');
  });

  it('is idempotent', () => {
    const once = foldWord('Môre', af);
    expect(foldWord(once, af)).toBe(once);
  });
});
