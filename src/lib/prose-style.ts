// Reader typography (#570) — how big, how heavy, how tight and how airy the
// body text of a lesson is drawn.
//
// A script does not read well at one setting. Japanese has no ascenders below
// the em box and writes no spaces, so a leading tuned for Latin leaves the
// lines too far apart. Arabic wants more room, not less. So the reader takes
// its typography from three layers, and each field resolves on its own:
//
//   1. The language pack (`script.prose`) — what the script needs.
//   2. The reader's global setting — what this person likes, in every language.
//   3. The reader's per-language setting — what this person likes in Japanese.
//
// The later layer wins. A pack default therefore never overrules a stated
// preference, and a global preference never overrules a per-language one.
//
// The resolved values reach the DOM as CSS custom properties on the reader
// container, so a word deep in the tree reads them by inheritance and no
// component needs the settings passed down to it.

import type { LanguageCode, LanguageConfig, ProseDefaults } from '@/lib/languages';

/** A complete, resolved reader typography. Every field carries a real value. */
export interface ProseStyle {
  /** Body text size in CSS pixels. */
  fontSize: number;
  /** Body text weight, 100 to 900. */
  fontWeight: number;
  /** Letter spacing in em. A negative value tightens the text. */
  letterSpacing: number;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
}

/** The fields of a `ProseStyle` a layer states. An absent field inherits. */
export type ProseStyleOverride = Partial<ProseStyle>;

/** Everything the reader stores about typography. */
export interface ProseStyleSettings {
  /** Applies in every language. */
  global: ProseStyleOverride;
  /** Applies in one language, over the top of `global`. */
  byLanguage: Partial<Record<LanguageCode, ProseStyleOverride>>;
}

export const EMPTY_PROSE_STYLE_SETTINGS: ProseStyleSettings = { global: {}, byLanguage: {} };

/**
 * What the reader drew before #570 made it configurable, so an account that
 * never opens the setting sees no change.
 *
 * 20px is the `sm:text-xl` step the article used on a wide screen. The narrow
 * step was 18px, and one value now covers both widths, because a size the
 * reader chose must not change under it at a breakpoint.
 *
 * 700 looks heavy for body text, and it is deliberate: every word in the reader
 * is a tappable chip, and the weight is what separated a word from the
 * punctuation between the words. It is now the first thing worth turning down.
 */
export const DEFAULT_PROSE_STYLE: ProseStyle = {
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: 0,
  lineHeight: 1.9,
};

/** The range each field accepts. A value outside it is clamped, never dropped. */
export const PROSE_STYLE_LIMITS: Record<keyof ProseStyle, { min: number; max: number }> = {
  fontSize: { min: 12, max: 40 },
  fontWeight: { min: 300, max: 800 },
  letterSpacing: { min: -0.05, max: 0.3 },
  lineHeight: { min: 1, max: 3.5 },
};

const PROSE_STYLE_FIELDS = Object.keys(PROSE_STYLE_LIMITS) as (keyof ProseStyle)[];

/**
 * Extra leading a paragraph of annotated words needs, added to the resolved
 * line height rather than replacing it (#289 4.4, #570).
 *
 * Added, so one control still governs the whole page. Replacing it with a fixed
 * annotated leading is what #570 reports as the fault: a reader who tightens
 * Japanese got no change at all while the furigana were on.
 *
 * An OVERHANGING annotation is out of flow, so it adds nothing to the line box
 * and the leading has to reserve the room itself. 0.25 fits a 0.58em reading.
 *
 * An IN-FLOW annotation is already part of the line box, so the browser has
 * added its height. The extra only keeps the lines from crowding, and 0.8 is
 * what Chinese needs to stay legible with pinyin over every word.
 */
export function annotationLeading(pack: LanguageConfig): number {
  return pack.pronunciation.annotationOverhang ? 0.25 : 0.8;
}

/**
 * The tightest an OVERHANGING annotation can be drawn at, whatever the reader
 * asked for.
 *
 * An out-of-flow reading takes its room from the gap between the lines, and the
 * browser reserves none for it. Below this the furigana of one line land on the
 * words of the line above, which is not a tight page — it is an unreadable one.
 *
 * The number is the sum of what has to fit: 1.0 for the Han em box, 0.58 for the
 * reading (see the `rt` size in WordCell), and the rest as margin.
 *
 * It does not apply to an IN-FLOW annotation. There the browser has already
 * counted the reading in the line box, so the lines cannot meet.
 */
export const MIN_ANNOTATED_LEADING = 1.75;

/** The line height an annotated paragraph is drawn at. */
export function annotatedLineHeight(style: ProseStyle, pack: LanguageConfig): number {
  const wanted = style.lineHeight + annotationLeading(pack);
  if (!pack.pronunciation.annotationOverhang) return wanted;
  return Math.max(wanted, MIN_ANNOTATED_LEADING);
}

function clampField(field: keyof ProseStyle, value: number): number {
  const { min, max } = PROSE_STYLE_LIMITS[field];
  return Math.min(max, Math.max(min, value));
}

/**
 * Keep the numbers of an override and drop everything else.
 *
 * The settings come out of browser storage, which anything can write, so a
 * field can arrive as a string, a NaN or absent. A bad field is dropped rather
 * than defaulted, so it falls through to the next layer instead of pinning the
 * reader to a value nobody chose.
 */
export function parseProseStyleOverride(input: unknown): ProseStyleOverride {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  const parsed: ProseStyleOverride = {};
  for (const field of PROSE_STYLE_FIELDS) {
    const value = source[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    parsed[field] = clampField(field, value);
  }
  return parsed;
}

/** Read the stored settings. Anything unrecognised is dropped, never thrown. */
export function parseProseStyleSettings(input: unknown): ProseStyleSettings {
  if (!input || typeof input !== 'object') return EMPTY_PROSE_STYLE_SETTINGS;
  const source = input as { global?: unknown; byLanguage?: unknown };
  const byLanguage: ProseStyleSettings['byLanguage'] = {};
  if (source.byLanguage && typeof source.byLanguage === 'object') {
    for (const [code, override] of Object.entries(source.byLanguage as Record<string, unknown>)) {
      const parsed = parseProseStyleOverride(override);
      // An empty override is the same as no override, and storing it would make
      // the settings page show a customisation the reader never made.
      if (Object.keys(parsed).length > 0) byLanguage[code as LanguageCode] = parsed;
    }
  }
  return { global: parseProseStyleOverride(source.global), byLanguage };
}

/**
 * Collapse the three layers into the typography one lesson is drawn with.
 *
 * Field by field, because the layers state different things: a pack can ask for
 * a tighter Japanese leading while the reader has asked for bigger text
 * everywhere, and both must hold.
 */
export function resolveProseStyle(
  pack: LanguageConfig,
  settings: ProseStyleSettings = EMPTY_PROSE_STYLE_SETTINGS,
): ProseStyle {
  const packDefaults: ProseDefaults = pack.script.prose ?? {};
  const perLanguage = settings.byLanguage[pack.code] ?? {};
  const resolved = { ...DEFAULT_PROSE_STYLE };
  for (const field of PROSE_STYLE_FIELDS) {
    const value = perLanguage[field] ?? settings.global[field] ?? packDefaults[field];
    if (typeof value === 'number' && Number.isFinite(value))
      resolved[field] = clampField(field, value);
  }
  return resolved;
}

/**
 * What a language shows in the settings page before the reader overrides
 * anything in it — the pack default under the global setting, with no
 * per-language layer.
 */
export function inheritedProseStyle(
  pack: LanguageConfig,
  settings: ProseStyleSettings = EMPTY_PROSE_STYLE_SETTINGS,
): ProseStyle {
  return resolveProseStyle(pack, { global: settings.global, byLanguage: {} });
}

/** True when this language carries a per-language override of its own. */
export function hasLanguageOverride(settings: ProseStyleSettings, code: LanguageCode): boolean {
  return Object.keys(settings.byLanguage[code] ?? {}).length > 0;
}

/** Replace the global override. */
export function withGlobalProseStyle(
  settings: ProseStyleSettings,
  global: ProseStyleOverride,
): ProseStyleSettings {
  return { global: parseProseStyleOverride(global), byLanguage: settings.byLanguage };
}

/**
 * Replace one language's override. An empty override removes the entry, so the
 * language goes back to inheriting.
 */
export function withLanguageProseStyle(
  settings: ProseStyleSettings,
  code: LanguageCode,
  override: ProseStyleOverride,
): ProseStyleSettings {
  const byLanguage = { ...settings.byLanguage };
  const parsed = parseProseStyleOverride(override);
  if (Object.keys(parsed).length > 0) byLanguage[code] = parsed;
  else delete byLanguage[code];
  return { global: settings.global, byLanguage };
}

/**
 * The custom properties the reader container publishes. Every text node under
 * it reads these, so `ReaderArticle`, `TranscriptReader` and `WordCell` all
 * follow one setting without threading it through their props.
 *
 * `--reader-line-height-annotated` is precomputed here rather than in CSS,
 * because the extra depends on the pack and CSS has no access to it.
 */
export function proseStyleVars(style: ProseStyle, pack: LanguageConfig): Record<string, string> {
  return {
    '--reader-font-size': `${style.fontSize}px`,
    '--reader-font-weight': String(style.fontWeight),
    '--reader-letter-spacing': `${style.letterSpacing}em`,
    '--reader-line-height': String(style.lineHeight),
    '--reader-line-height-annotated': String(
      Math.round(annotatedLineHeight(style, pack) * 1000) / 1000,
    ),
  };
}
