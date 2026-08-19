import { isValidElement, type ReactNode, type ReactElement } from 'react';
import {
  tokenize,
  snapToWordBoundaries as snapOffsetsToWordBoundaries,
  foldWord,
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
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const words = parsed.filter((item): item is string => typeof item === 'string');
    return words.length > 0 ? words : null;
  } catch {
    return null;
  }
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

  return range.toString().trim();
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
