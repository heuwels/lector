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
   * zh, rule-derived IPA for eo. Omit for no annotation.
   */
  reading?: string;
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
  testId = 'reader-word',
}: WordCellProps) {
  const colorClass = state ? stateClasses[state] : stateClasses.new;
  const isHighlighted = isPhraseHighlighted || isActive;

  return (
    <span
      data-leaf=""
      data-testid={testId}
      // Test hook for the rendered word state — the e2e suite asserts on it to
      // check a save landed without reading colors out of the computed style.
      data-word-state={state ?? 'new'}
      role="button"
      tabIndex={0}
      aria-label={`Look up ${text}`}
      onClick={(event) => onActivate?.(text, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onActivate?.(text, event.currentTarget);
      }}
      data-phrase-highlighted={isPhraseHighlighted || undefined}
      data-active-word={isActive || undefined}
      className={`cursor-pointer rounded-[7px] px-[7px] font-bold hover:ring-2 hover:ring-ring/50 ${colorClass} ${isActive ? 'ring-2 ring-[var(--clay)]' : ''}`}
      style={
        isHighlighted
          ? { backgroundColor: 'color-mix(in srgb, var(--clay) 22%, transparent)' }
          : undefined
      }
    >
      {reading ? (
        <ruby>
          {text}
          {/* No <rp> fallback: every browser lector supports renders ruby, and
              the extra nodes would double the text every DOM read has to skip. */}
          {/* 0.58em, not the browser default of 0.5: pinyin carries tone marks
              that need the extra pixel to read at body size. `select-none` is
              what keeps the reading out of a copied selection. */}
          <rt className="text-[0.58em] leading-none font-normal tracking-tight opacity-75 select-none">
            {reading}
          </rt>
        </ruby>
      ) : (
        text
      )}
    </span>
  );
}
