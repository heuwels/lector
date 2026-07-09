// Grapheme-safe string primitives (#289 Phase 0, item 0.5).
// `string.length` and `slice()` count UTF-16 code units, which splits
// surrogate pairs and separates base characters from combining marks —
// visible as broken hint reveals and wrong input widths for Greek/Arabic/
// Hebrew/CJK. `Intl.Segmenter` (available in all target browsers and in Bun)
// counts user-perceived characters instead.

const segmenters = new Map<string, Intl.Segmenter>();

function graphemeSegmenter(locale?: string): Intl.Segmenter {
  const key = locale ?? '';
  let segmenter = segmenters.get(key);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
    segmenters.set(key, segmenter);
  }
  return segmenter;
}

/** Split into user-perceived characters (grapheme clusters). */
export function graphemeSplit(text: string, locale?: string): string[] {
  const out: string[] = [];
  for (const { segment } of graphemeSegmenter(locale).segment(text)) {
    out.push(segment);
  }
  return out;
}

/** Number of user-perceived characters (never inflated by combining marks or surrogates). */
export function graphemeLength(text: string, locale?: string): number {
  let n = 0;
  for (const _ of graphemeSegmenter(locale).segment(text)) n++;
  return n;
}

/**
 * The first `count` user-perceived characters — never splits a base character
 * from its combining marks or tears a surrogate pair.
 */
export function graphemeSlice(text: string, count: number, locale?: string): string {
  if (count <= 0) return '';
  let taken = 0;
  for (const { index } of graphemeSegmenter(locale).segment(text)) {
    if (taken === count) return text.slice(0, index);
    taken++;
  }
  return text;
}
