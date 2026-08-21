import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '@/lib/languages';

// The reader labels its content with the LESSON's language, because Han
// unification gives one codepoint different glyph shapes per language. A pack
// whose bcp47 tag cannot select those shapes would defeat the attribute, so
// pin the tags the reader hands to `lang`.
describe('reader lang attribute', () => {
  it('gives every pack a bcp47 tag and a direction', () => {
    for (const [code, pack] of Object.entries(LANGUAGES)) {
      expect(pack.script.bcp47, code).toBeTruthy();
      expect(['ltr', 'rtl'], code).toContain(pack.script.direction);
    }
  });

  // The three that share Han characters must stay distinguishable, or the
  // browser cannot pick between the Japanese and the Chinese glyph forms.
  it('separates the Han-sharing packs by tag', () => {
    expect(LANGUAGES.ja.script.bcp47).toBe('ja');
    expect(LANGUAGES.zh.script.bcp47).toBe('zh-Hans');
    expect(LANGUAGES.ja.script.bcp47).not.toBe(LANGUAGES.zh.script.bcp47);
  });

  // A bare 'zh' would let the browser choose Traditional shapes. The script
  // subtag is what pins Simplified.
  it('keeps the script subtag on Chinese', () => {
    expect(LANGUAGES.zh.script.bcp47).toContain('-Hans');
  });
});
