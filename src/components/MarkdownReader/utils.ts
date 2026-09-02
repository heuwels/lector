import { isValidElement, type ReactNode, type ReactElement } from 'react';
import {
  tokenize,
  snapToWordBoundaries as snapOffsetsToWordBoundaries,
  foldWord,
  parseStoredSegmentWords,
  type LanguageConfig,
  type Token,
  type WordSegmentation,
} from '@/lib/languages';

/**
 * Read `lessons.segmentWords` (#289 4.2). A malformed value degrades to null
 * rather than throwing: the reader can always fall back to `Intl.Segmenter`, so
 * one bad row must not blank the page.
 */
export function parseSegmentWords(value: string | null | undefined): string[] | null {
  // Delegates to the shared implementation so the API and the reader cannot
  // disagree about what a stored segmentation means.
  return parseStoredSegmentWords(value);
}

// Ruby annotation elements (#289 4.4). `<rt>` holds the reading; `<rp>` holds
// the fallback parentheses a non-ruby browser shows instead. Both are ANNOTATION,
// never content, so every path that reads text out of the DOM must skip them.
const ANNOTATION_TAGS = new Set(['RT', 'RP']);

// Numeric nodeType constants rather than `Node.ELEMENT_NODE`. The `Node` global
// does not exist outside a browser, so referencing it would throw under the
// node-environment unit tests and during any server render.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * The text of a DOM subtree, excluding ruby annotations.
 *
 * `textContent` interleaves them. Measured in Chromium on
 * `<ruby>我<rt>wǒ</rt></ruby><ruby>喜欢<rt>xǐhuan</rt></ruby>`, `textContent`
 * gives "我wǒ喜欢xǐhuan" where the sentence is "我喜欢". That string is not
 * cosmetic: `findSentence` feeds it to `wordPanel.sentence`, which is persisted
 * to `vocab.sentence` and later validated by the Anki cloze builder, so an
 * interleaved read corrupts saved vocabulary and fails the export.
 */
export function readableText(node: Node): string {
  if (node.nodeType === TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType === ELEMENT_NODE && ANNOTATION_TAGS.has((node as Element).tagName)) {
    return '';
  }
  let out = '';
  for (const child of Array.from(node.childNodes)) out += readableText(child);
  return out;
}

/**
 * A Range's text, excluding ruby annotations.
 *
 * `range.toString()` cannot be used: unlike a selection it ignores
 * `user-select: none`, so the CSS guard that keeps annotations out of a copy
 * does NOT keep them out of this. Verified in Chromium — with
 * `rt { user-select: none }`, `selection.toString()` returns "我喜欢读书。" while
 * `range.toString()` still returns "我wǒ喜欢xǐhuan读书dúshū。".
 *
 * `cloneContents` is a detached fragment, so walking it cannot disturb the live
 * selection or the rendered DOM.
 */
export function readableRangeText(range: Range): string {
  return readableText(range.cloneContents());
}

// Expand a selection to full word boundaries. DOM wrapper around the pure
// offset-based snapper in languages/tokenizer — per-pack so it follows the
// active script instead of hardcoded Latin ranges (#289).
export function snapToWordBoundaries(
  selection: Selection,
  pack: LanguageConfig,
  words?: WordSegmentation | null,
): string {
  const range = selection.getRangeAt(0);

  const startContainer = range.startContainer;
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const text = startContainer.textContent || '';
    const { start } = snapOffsetsToWordBoundaries(
      text,
      range.startOffset,
      range.startOffset,
      pack,
      words,
    );
    range.setStart(startContainer, start);
  }

  const endContainer = range.endContainer;
  if (endContainer.nodeType === Node.TEXT_NODE) {
    const text = endContainer.textContent || '';
    const { end } = snapOffsetsToWordBoundaries(
      text,
      range.endOffset,
      range.endOffset,
      pack,
      words,
    );
    range.setEnd(endContainer, end);
  }

  return readableRangeText(range).trim();
}

export interface TextPart {
  text: string;
  isWord: boolean;
}

/**
 * Split a string into alternating word / non-word parts (pure). Thin wrapper
 * over the shared per-pack tokenizer (#289) — the word shape lives in
 * languages/tokenizer, not here.
 */
export function splitWords(
  text: string,
  pack: LanguageConfig,
  words?: WordSegmentation | null,
): TextPart[] {
  return tokenize(text, pack, words).map((t: Token) => ({ text: t.text, isWord: t.isWord }));
}

/**
 * Collect a react-markdown block's words in document order, splitting each
 * string leaf exactly the way the renderer does — including words nested inside
 * inline elements (<strong>/<em>/<a>/…). The resulting order matches the spans
 * produced during rendering, so phrase-highlight indices line up.
 *
 * `words` must be the same segmentation the renderer uses, or the collected
 * order stops matching the rendered spans and phrase highlighting lands on the
 * wrong words.
 */
export function collectWords(
  children: ReactNode,
  pack: LanguageConfig,
  words?: WordSegmentation | null,
): string[] {
  if (typeof children === 'string') {
    return splitWords(children, pack, words)
      .filter((p) => p.isWord)
      .map((p) => p.text);
  }
  if (Array.isArray(children)) {
    return children.flatMap((child) => collectWords(child, pack, words));
  }
  if (isValidElement(children)) {
    return collectWords(
      (children as ReactElement<{ children?: ReactNode }>).props.children,
      pack,
      words,
    );
  }
  return [];
}

/**
 * Indices (into a block's word list) covered by the currently highlighted
 * phrase. Matches the first contiguous run, comparing folded word keys
 * (case-insensitive; script-aware via foldWord). Empty phrase or no match →
 * empty set. `phrase` entries are already folded by the caller.
 */
export function computePhraseHighlightSet(
  blockWords: string[],
  phrase: string[],
  pack: LanguageConfig,
): Set<number> {
  const set = new Set<number>();
  if (phrase.length === 0 || phrase.length > blockWords.length) return set;
  for (let i = 0; i <= blockWords.length - phrase.length; i++) {
    let matches = true;
    for (let j = 0; j < phrase.length; j++) {
      if (foldWord(blockWords[i + j], pack) !== phrase[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      for (let j = 0; j < phrase.length; j++) set.add(i + j);
      return set;
    }
  }
  return set;
}

/**
 * The inclusive run between two endpoints of an ordered list, in that order.
 *
 * `spans` must hold a block's word spans in document order, so a drag that ran
 * backwards returns the same run as the forward drag. An endpoint that is not
 * in the list returns nothing.
 */
export function wordSpansBetween<T>(anchor: T, focus: T, spans: readonly T[]): T[] {
  const start = spans.indexOf(anchor);
  const end = spans.indexOf(focus);
  if (start < 0 || end < 0) return [];
  return start <= end ? spans.slice(start, end + 1) : spans.slice(end, start + 1);
}
