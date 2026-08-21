import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '@/lib/languages';
import { readerWrapClass } from './wrap';

describe('reader line breaking', () => {
  it('holds a Korean eojeol together', () => {
    expect(readerWrapClass(LANGUAGES.ko)).toBe('break-keep');
  });

  // keep-all on an unspaced script leaves one unbreakable line, because there
  // is no space to break at.
  it('leaves the unspaced scripts to the browser', () => {
    expect(readerWrapClass(LANGUAGES.zh)).toBe('');
    expect(readerWrapClass(LANGUAGES.ja)).toBe('');
  });

  it('leaves the spaced alphabetic scripts alone', () => {
    expect(readerWrapClass(LANGUAGES.af)).toBe('');
    expect(readerWrapClass(LANGUAGES.ru)).toBe('');
    expect(readerWrapClass(LANGUAGES.grc)).toBe('');
  });

  it('applies to every hangul pack and no other', () => {
    for (const [code, pack] of Object.entries(LANGUAGES)) {
      const expected = pack.script.kind === 'hangul' ? 'break-keep' : '';
      expect(readerWrapClass(pack), code).toBe(expected);
    }
  });
});
