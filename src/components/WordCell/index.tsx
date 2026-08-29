'use client';

import type { WordState } from '@/types';
import { stateClasses } from '@/components/MarkdownReader/theme';

export interface WordCellProps {
  text: string;
  /** Word state from the known-words map; undefined renders as 'new'. */
  state?: WordState;
  /** The currently looked-up word (drawer open) — ring highlight. */
  isActive?: boolean;
  /** Part of the highlighted phrase selection. */
  isPhraseHighlighted?: boolean;
  /** Tap/Enter/Space. The element is passed so callers can find the sentence context. */
  onActivate?: (text: string, element: HTMLElement) => void;
  /**
   * Pronunciation printed above the word as HTML ruby (#289 4.4) — pinyin for
   * zh, furigana for ja. Omit for no annotation.
   */
  reading?: string;
  /**
   * Draw the reading out of flow rather than letting ruby layout widen the word
   * (`pronunciation.annotationOverhang`). True for a script whose annotation is
   * no wider than the word, false where it is wider and needs the room.
   */
  readingOverhangs?: boolean;
  testId?: string;
}

/**
 * One tappable word with the reader's known/level coloring — extracted from
 * MarkdownReader's ReaderBlock (#185) so listen-along renders segments with
 * the exact same word-state chips instead of flat text. Any surface that
 * shows target-language words with vocab coloring should render these.
 *
 * `data-leaf` marks the span as already-rendered for MarkdownReader's
 * renderChildren walk; it's inert everywhere else.
 */
export default function WordCell({
  text,
  state,
  isActive = false,
  isPhraseHighlighted = false,
  onActivate,
  reading,
  readingOverhangs = false,
  testId = 'reader-word',
}: WordCellProps) {
  const colorClass = state ? stateClasses[state] : stateClasses.new;
  const isHighlighted = isPhraseHighlighted || isActive;
  // A word with no handler is decoration — the settings preview (#570) draws the
  // chips to show a typography change, and there is nothing to look up. Button
  // semantics there would put five dead stops in the keyboard order and read
  // "Look up X" to a screen reader for a word that is not in the lesson.
  const interactive = onActivate !== undefined;

  return (
    <span
      data-leaf=""
      data-testid={testId}
      // Test hook for the rendered word state — the e2e suite asserts on it to
      // check a save landed without reading colors out of the computed style.
      data-word-state={state ?? 'new'}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Look up ${text}` : undefined}
      onClick={(event) => onActivate?.(text, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onActivate?.(text, event.currentTarget);
      }}
      data-phrase-highlighted={isPhraseHighlighted || undefined}
      data-active-word={isActive || undefined}
      // An OVERHANGING annotation needs `relative` to anchor it, and it drops
      // the border and tightens the padding: with a reading above every word
      // the full chip turned the page into a grid of buttons instead of prose.
      // A wide annotation keeps ruby layout and the original padding, because it
      // needs that room to avoid the neighbouring word.
      className={`rounded-[7px] ${interactive ? 'cursor-pointer hover:ring-2 hover:ring-ring/50' : ''} ${
        reading && readingOverhangs ? 'relative border-transparent px-[3px]' : 'px-[7px]'
      } ${colorClass} ${isActive ? 'ring-2 ring-[var(--clay)]' : ''}`}
      // The weight is a reader setting (#570). The fallback is the 700 this used
      // to hardcode, so a surface outside the reader — listen-along, practice —
      // publishes no custom property and draws exactly as it did before.
      style={{
        fontWeight: 'var(--reader-font-weight, 700)',
        ...(isHighlighted
          ? { backgroundColor: 'color-mix(in srgb, var(--clay) 22%, transparent)' }
          : {}),
      }}
    >
      {reading ? (
        <ruby>
          {text}
          {/* No <rp> fallback: every browser lector supports renders ruby, and
              the extra nodes would double the text every DOM read has to skip. */}
          {/* Two layouts, and which one is right depends on the script. See
              `annotationOverhang`.

              Out of flow (ja): ruby layout widens the BASE to fit the
              annotation, so 勉強 drew as 勉 強 while its neighbours stayed
              tight. Kana is no wider than its kanji, so taking it out of flow
              costs nothing and keeps every word its own width.

              In flow (zh): pinyin IS wider than its hanzi. chángcháng needs more
              room than 常常 has, so out of flow it collided with the word
              beside it. Letting the browser widen the base is correct here.

              0.58em, not the browser default of 0.5: a tone mark or a small
              kana needs the extra pixel at body size. `select-none` is what
              keeps the reading out of a copied selection. */}
          <rt
            className={`text-[0.58em] leading-none font-normal tracking-tight opacity-75 select-none ${
              readingOverhangs
                ? 'absolute bottom-full left-1/2 -translate-x-1/2 whitespace-nowrap'
                : ''
            }`}
          >
            {reading}
          </rt>
        </ruby>
      ) : (
        text
      )}
    </span>
  );
}
