'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { isComposing } from '@/lib/keyboard';
import type { WordState } from '@/types';
import type { ActiveReaderWord } from './ReaderArticle';
import { readableRangeText, wordSpansBetween } from './utils';

const WORD_SELECTOR = '[data-word-state]';

export const STATE_SHORTCUTS: Record<string, WordState> = {
  '1': 'level1',
  '2': 'level2',
  '3': 'level3',
  '4': 'level4',
  '5': 'level5',
  '6': 'level6',
  '7': 'level7',
  k: 'known',
  x: 'ignored',
  i: 'ignored',
};

export interface NavigationCallbacks {
  onNavigate: (word: ActiveReaderWord) => void;
  /** Build phrase highlight from a contiguous range of word elements. */
  onSelectPhrase: (text: string) => void;
  /** Clear phrase highlight (keeps active word — used by plain arrow navigation). */
  onClearPhrase: () => void;
  onClearSelection: () => void;
  onCloseDrawer: () => void;
  onStateShortcut: (state: WordState) => void | Promise<void>;
  onLookUpWord: (word: string) => void;
  onSaveWord?: () => void;
}

export function parseWordElement(el: {
  getAttribute: (name: string) => string | null;
}): ActiveReaderWord | null {
  const blockId = el.getAttribute('data-block-id');
  const wordIndex = el.getAttribute('data-word-index');
  if (blockId === null || wordIndex === null) return null;
  return { blockId: Number(blockId), wordIndex: Number(wordIndex) };
}

/** Round to the nearest 4px grid for line grouping. */
function lineOf(top: number): number {
  return Math.round(top / 4) * 4;
}

/**
 * Find the word on the visual line above or below the current word.
 * Groups words by their rendered vertical position, not DOM order,
 * so Up/Down follows the actual text layout (including wrapped lines).
 */
function findWordByGeometry(
  words: HTMLElement[],
  current: HTMLElement,
  direction: 'up' | 'down',
): HTMLElement | null {
  const currentRect = current.getBoundingClientRect();
  const currentCenterX = currentRect.left + currentRect.width / 2;
  const currentLine = lineOf(currentRect.top);

  // Group words by visual line (top position grid).
  const groups = new Map<number, HTMLElement[]>();
  for (const w of words) {
    if (w === current) continue;
    const rect = w.getBoundingClientRect();
    const l = lineOf(rect.top);
    if (l === currentLine) continue;
    const arr = groups.get(l) ?? [];
    arr.push(w);
    groups.set(l, arr);
  }

  const sortedLines = Array.from(groups.keys()).sort((a, b) => a - b);
  let targetLine: number | null = null;

  if (direction === 'down') {
    const below = sortedLines.filter((l) => l > currentLine);
    targetLine = below.length > 0 ? below[0] : null;
  } else {
    const above = sortedLines.filter((l) => l < currentLine);
    targetLine = above.length > 0 ? above[above.length - 1] : null;
  }

  if (targetLine === null) return null;

  const candidates = groups.get(targetLine) ?? [];
  // Among words on the target line, pick the one whose horizontal center
  // is closest to the current word's center.
  return candidates.reduce(
    (closest, w) => {
      const rect = w.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const dist = Math.abs(centerX - currentCenterX);
      return dist < closest.dist ? { el: w, dist } : closest;
    },
    { el: candidates[0], dist: Infinity },
  ).el;
}

/**
 * Keyboard navigation for the reader article.
 *
 * Listens on `window` (not the container) so key events are caught regardless
 * of whether focus is on a reader word, on <body>, or inside the portaled
 * translation drawer. Guards skip events from input/textarea/contentEditable,
 * IME composition, and modifier-key combos.
 *
 * A persistent cursor ref tracks the "keyboard-selected" word across keydowns,
 * synced from `activeWord` whenever the user clicks a word. Arrow keys move
 * the cursor; Up/Down use getBoundingClientRect geometry so they follow visual
 * line wrapping, not DOM order. When the drawer is open, each arrow press also
 * triggers a lookup so the drawer updates live.
 *
 * `containerRef` is used only for DOM queries (finding word spans), not for
 * the event listener.
 */
export function useReaderKeyboardNavigation(
  containerRef: RefObject<HTMLElement | null>,
  wordPanelOpen: boolean,
  activeWord: ActiveReaderWord | null,
  callbacks: NavigationCallbacks,
) {
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  // Persistent cursor — survives across keydowns and re-renders.
  const cursorRef = useRef<ActiveReaderWord | null>(null);

  // Shift-selection anchor — set on the first Shift+Arrow, stays fixed while
  // the cursor extends. Reset on plain arrow, Escape, state shortcuts, and
  // any mouse click that changes activeWord.
  const anchorRef = useRef<ActiveReaderWord | null>(null);

  // Resolve an ActiveReaderWord position to its DOM element.
  const elementAt = (pos: ActiveReaderWord | null, words: HTMLElement[]): HTMLElement | null => {
    if (!pos) return null;
    return (
      words.find(
        (w) =>
          w.getAttribute('data-block-id') === String(pos.blockId) &&
          w.getAttribute('data-word-index') === String(pos.wordIndex),
      ) ?? null
    );
  };

  // Sync cursor from activeWord whenever it changes (mouse clicks, auto-advance).
  // Also resets the shift-selection anchor so each click starts fresh.
  useEffect(() => {
    if (activeWord) {
      cursorRef.current = activeWord;
      anchorRef.current = null;
    }
  }, [activeWord]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (isComposing(event)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // --- Arrow navigation ---
      const isArrow =
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight';

      if (isArrow) {
        const container = containerRef.current;
        const words = container
          ? Array.from(container.querySelectorAll<HTMLElement>(WORD_SELECTOR))
          : [];
        if (words.length === 0) return;

        event.preventDefault();

        const cursor = cursorRef.current;
        let currentEl: HTMLElement | null = null;

        if (cursor) {
          currentEl =
            container?.querySelector<HTMLElement>(
              `${WORD_SELECTOR}[data-block-id="${cursor.blockId}"][data-word-index="${cursor.wordIndex}"]`,
            ) ?? null;
        }

        // If cursor has no DOM element (e.g. lesson changed), fall back to active
        // element or the first word.
        if (!currentEl) {
          const activeEl = document.activeElement as HTMLElement | null;
          const activeIdx = words.indexOf(activeEl as HTMLElement);
          currentEl = activeIdx >= 0 ? (activeEl as HTMLElement) : words[0];
          const pos = parseWordElement(currentEl);
          if (pos) {
            cursorRef.current = pos;
          }
        }

        if (!currentEl) return;

        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
        let next: HTMLElement | null = null;

        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          // Vertical movement uses geometry (visual lines, not DOM order).
          next = findWordByGeometry(words, currentEl, forward ? 'down' : 'up');
        } else {
          // Horizontal movement uses DOM order.
          const idx = words.indexOf(currentEl);
          next = forward ? words[idx + 1] : words[idx - 1];
        }

        if (!next) return;

        const nextPos = parseWordElement(next);
        if (nextPos) {
          const prevCursor = cursorRef.current;
          cursorRef.current = nextPos;
          if (event.shiftKey) {
            // Shift+Arrow: extend the phrase selection from a fixed anchor.
            // On the first Shift+Arrow the anchor is the cursor position
            // before this move (the word that was clicked or navigated to).
            // Subsequent presses keep the anchor fixed and move only the
            // cursor, so Shift+Right keeps right-extending the range.
            if (!anchorRef.current) {
              anchorRef.current = prevCursor ?? nextPos;
            }
            const anchorEl = elementAt(anchorRef.current, words);
            if (anchorEl) {
              const span = wordSpansBetween(anchorEl, next, words);
              const first = span[0];
              const last = span[span.length - 1];
              if (first && last) {
                const range = document.createRange();
                range.setStartBefore(first);
                range.setEndAfter(last);
                const text = readableRangeText(range).trim();
                callbacksRef.current.onSelectPhrase(text);
                if (wordPanelOpen) {
                  callbacksRef.current.onLookUpWord(text);
                }
              }
            }
          } else {
            // Plain arrow: clear the shift anchor, phrase highlight, and move cursor.
            anchorRef.current = null;
            callbacksRef.current.onClearPhrase();
            callbacksRef.current.onNavigate(nextPos);
            if (wordPanelOpen) {
              callbacksRef.current.onLookUpWord(next.textContent || '');
            }
          }
        }
        next.focus({ preventScroll: true });
        return;
      }

      // Only remaining shortcuts need the drawer to be open.
      if (!wordPanelOpen) return;

      // --- Escape: clear selection first, then close drawer ---
      if (event.key.toLowerCase() === 'escape') {
        event.preventDefault();
        event.stopPropagation();
        if (cursorRef.current !== null) {
          // First Escape: clear the active-word/phrase highlight, keep drawer open.
          cursorRef.current = null;
          anchorRef.current = null;
          callbacksRef.current.onClearSelection();
        } else {
          // Second Escape: close the drawer.
          callbacksRef.current.onCloseDrawer();
        }
        return;
      }

      // --- 's': save word to vocab ---
      if (event.key.toLowerCase() === 's' && callbacksRef.current.onSaveWord) {
        event.preventDefault();
        event.stopPropagation();
        callbacksRef.current.onSaveWord();
        return;
      }

      // --- State shortcuts (1-7, k, x, i): assign state + auto-advance ---
      const key = event.key.toLowerCase();
      if (STATE_SHORTCUTS[key]) {
        event.preventDefault();
        event.stopPropagation();
        const state = STATE_SHORTCUTS[key];

        const autoAdvance = async () => {
          await callbacksRef.current.onStateShortcut(state);
          const container = containerRef.current;
          const words = container
            ? Array.from(container.querySelectorAll<HTMLElement>(WORD_SELECTOR))
            : [];
          const currentIdx = cursorRef.current
            ? words.findIndex(
                (w) =>
                  w.getAttribute('data-block-id') === String(cursorRef.current!.blockId) &&
                  w.getAttribute('data-word-index') === String(cursorRef.current!.wordIndex),
              )
            : -1;
          const next =
            currentIdx >= 0 && currentIdx + 1 < words.length ? words[currentIdx + 1] : null;
          if (next) {
            const nextPos = parseWordElement(next);
            if (nextPos) {
              cursorRef.current = nextPos;
              anchorRef.current = null;
              callbacksRef.current.onNavigate(nextPos);
              callbacksRef.current.onLookUpWord(next.textContent || '');
            }
            next.focus({ preventScroll: true });
          }
        };
        void autoAdvance();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [containerRef, wordPanelOpen]);
}
