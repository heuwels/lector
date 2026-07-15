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
  testId = 'reader-word',
}: WordCellProps) {
  const colorClass = state ? stateClasses[state] : stateClasses.new;
  const isHighlighted = isPhraseHighlighted || isActive;

  return (
    <span
      data-leaf=""
      data-testid={testId}
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
      {text}
    </span>
  );
}
