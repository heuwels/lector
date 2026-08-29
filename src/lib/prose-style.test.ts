import { describe, expect, it } from 'vitest';
import { getLanguageConfig } from '@/lib/languages';
import {
  DEFAULT_PROSE_STYLE,
  EMPTY_PROSE_STYLE_SETTINGS,
  MIN_ANNOTATED_LEADING,
  annotationLeading,
  hasLanguageOverride,
  inheritedProseStyle,
  parseProseStyleOverride,
  parseProseStyleSettings,
  proseStyleVars,
  resolveProseStyle,
  withGlobalProseStyle,
  withLanguageProseStyle,
} from './prose-style';

const de = getLanguageConfig('de');
const ja = getLanguageConfig('ja');
const zh = getLanguageConfig('zh');

describe('resolveProseStyle', () => {
  it('draws a Latin lesson exactly as it did before #570 when nothing is set', () => {
    expect(resolveProseStyle(de)).toEqual(DEFAULT_PROSE_STYLE);
  });

  it('takes a pack default where the pack states one', () => {
    // ja tightens the leading and states nothing else.
    expect(resolveProseStyle(ja)).toEqual({ ...DEFAULT_PROSE_STYLE, lineHeight: 1.7 });
  });

  it("lets the reader's global setting beat a pack default", () => {
    const settings = { global: { lineHeight: 2.4 }, byLanguage: {} };
    expect(resolveProseStyle(ja, settings).lineHeight).toBe(2.4);
  });

  it('lets a per-language setting beat the global one', () => {
    const settings = { global: { fontSize: 26 }, byLanguage: { ja: { fontSize: 18 } } };
    expect(resolveProseStyle(ja, settings).fontSize).toBe(18);
    expect(resolveProseStyle(de, settings).fontSize).toBe(26);
  });

  it('resolves each field on its own, so the layers can state different things', () => {
    // The reader wants bigger text everywhere. The ja pack wants a tighter
    // leading. Both must hold.
    const settings = { global: { fontSize: 24 }, byLanguage: {} };
    expect(resolveProseStyle(ja, settings)).toEqual({
      ...DEFAULT_PROSE_STYLE,
      fontSize: 24,
      lineHeight: 1.7,
    });
  });

  it('clamps a stored value that is out of range instead of dropping it', () => {
    const settings = { global: { fontSize: 900, lineHeight: 0 }, byLanguage: {} };
    expect(resolveProseStyle(de, settings).fontSize).toBe(40);
    expect(resolveProseStyle(de, settings).lineHeight).toBe(1);
  });
});

describe('inheritedProseStyle', () => {
  it('ignores the language its own override, so the panel can show what it would inherit', () => {
    const settings = { global: { fontSize: 24 }, byLanguage: { ja: { fontSize: 14 } } };
    expect(inheritedProseStyle(ja, settings).fontSize).toBe(24);
  });
});

describe('annotationLeading', () => {
  it('adds less for an out-of-flow reading than for one in the line box', () => {
    // ja furigana overhangs; zh pinyin widens the word inside the line box.
    expect(annotationLeading(ja)).toBe(0.25);
    expect(annotationLeading(zh)).toBe(0.8);
  });
});

describe('proseStyleVars', () => {
  it('publishes the annotated leading as the resolved leading plus the extra', () => {
    const vars = proseStyleVars(resolveProseStyle(de), de);
    expect(vars['--reader-line-height']).toBe('1.9');
    // 1.9 + 0.8 — the 2.7 the Chinese-style in-flow layout used to hardcode.
    expect(vars['--reader-line-height-annotated']).toBe('2.7');
  });

  it('moves the annotated leading with the reader setting, which is the #570 fault', () => {
    // Above the floor, so the extra is what decides it.
    const settings = { global: { lineHeight: 2.5 }, byLanguage: {} };
    const vars = proseStyleVars(resolveProseStyle(ja, settings), ja);
    expect(vars['--reader-line-height']).toBe('2.5');
    expect(vars['--reader-line-height-annotated']).toBe('2.75');
  });

  it('holds an overhanging annotation off the line above, however tight the setting', () => {
    // Measured: furigana touch the line above at 2.15 and collide below it, so
    // no reader setting may take the annotated paragraphs under the floor. The
    // body text still tightens to 1.2 — only the annotated lines stop.
    const settings = { global: { lineHeight: 1.2 }, byLanguage: {} };
    const vars = proseStyleVars(resolveProseStyle(ja, settings), ja);
    expect(vars['--reader-line-height']).toBe('1.2');
    expect(vars['--reader-line-height-annotated']).toBe(String(MIN_ANNOTATED_LEADING));
  });

  it('holds the ja pack default itself above the floor', () => {
    // 1.7 + 0.25 is under the floor, so plain Japanese reads tight while an
    // annotated paragraph keeps the room the furigana need.
    const vars = proseStyleVars(resolveProseStyle(ja), ja);
    expect(vars['--reader-line-height']).toBe('1.7');
    expect(vars['--reader-line-height-annotated']).toBe(String(MIN_ANNOTATED_LEADING));
  });

  it('applies no floor to an in-flow annotation, which cannot collide', () => {
    // zh pinyin is part of the line box, so the browser has already made room.
    const settings = { global: { lineHeight: 0.9 }, byLanguage: {} };
    const style = resolveProseStyle(zh, settings);
    // 1 is the tightest the limits allow.
    expect(style.lineHeight).toBe(1);
    expect(proseStyleVars(style, zh)['--reader-line-height-annotated']).toBe('1.8');
  });

  it('emits units the browser accepts', () => {
    const vars = proseStyleVars(
      resolveProseStyle(de, { global: { fontSize: 22, letterSpacing: 0.02 }, byLanguage: {} }),
      de,
    );
    expect(vars['--reader-font-size']).toBe('22px');
    expect(vars['--reader-letter-spacing']).toBe('0.02em');
    expect(vars['--reader-font-weight']).toBe('700');
  });
});

describe('parseProseStyleOverride', () => {
  it('drops a field that is not a finite number rather than defaulting it', () => {
    const parsed = parseProseStyleOverride({
      fontSize: '22',
      fontWeight: Number.NaN,
      letterSpacing: null,
      lineHeight: 1.7,
    });
    expect(parsed).toEqual({ lineHeight: 1.7 });
  });

  it('ignores a field the app does not know', () => {
    expect(parseProseStyleOverride({ fontFamily: 'Comic Sans' })).toEqual({});
  });

  it('survives a value that is not an object', () => {
    expect(parseProseStyleOverride('nonsense')).toEqual({});
    expect(parseProseStyleOverride(null)).toEqual({});
  });
});

describe('parseProseStyleSettings', () => {
  it('reads a stored payload', () => {
    const parsed = parseProseStyleSettings({
      global: { fontSize: 22 },
      byLanguage: { ja: { lineHeight: 1.5 } },
    });
    expect(parsed).toEqual({ global: { fontSize: 22 }, byLanguage: { ja: { lineHeight: 1.5 } } });
  });

  it('drops a language whose override has nothing usable left in it', () => {
    const parsed = parseProseStyleSettings({ byLanguage: { ja: { fontSize: 'big' } } });
    expect(parsed.byLanguage).toEqual({});
  });

  it('returns the empty settings for anything unrecognised', () => {
    expect(parseProseStyleSettings(42)).toEqual(EMPTY_PROSE_STYLE_SETTINGS);
  });
});

describe('withLanguageProseStyle', () => {
  it('removes the entry when the override is emptied, so the language inherits again', () => {
    const settings = { global: {}, byLanguage: { ja: { fontSize: 18 } } };
    const next = withLanguageProseStyle(settings, 'ja', {});
    expect(hasLanguageOverride(next, 'ja')).toBe(false);
    expect(resolveProseStyle(ja, next).fontSize).toBe(DEFAULT_PROSE_STYLE.fontSize);
  });

  it('leaves the other languages alone', () => {
    const settings = { global: {}, byLanguage: { ja: { fontSize: 18 }, de: { fontSize: 26 } } };
    const next = withLanguageProseStyle(settings, 'ja', { fontSize: 19 });
    expect(next.byLanguage.de).toEqual({ fontSize: 26 });
  });
});

describe('withGlobalProseStyle', () => {
  it('keeps the per-language corrections', () => {
    const settings = { global: {}, byLanguage: { ja: { lineHeight: 1.5 } } };
    const next = withGlobalProseStyle(settings, { fontSize: 24 });
    expect(next.byLanguage.ja).toEqual({ lineHeight: 1.5 });
    expect(resolveProseStyle(ja, next)).toEqual({
      ...DEFAULT_PROSE_STYLE,
      fontSize: 24,
      lineHeight: 1.5,
    });
  });
});
