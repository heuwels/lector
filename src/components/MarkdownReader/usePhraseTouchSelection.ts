'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { wordSpansBetween } from './utils';

// Every WordCell carries `data-word-state`; the spans between words do not.
const WORD_SELECTOR = '[data-word-state]';
// TranscriptReader wraps a segment in a <p> so this list also matches there.
const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6';
// Shorter than the ~500ms a browser waits before it starts its own selection.
const HOLD_MS = 350;
// Movement over this many CSS pixels before the hold completes is a scroll.
const SLOP_PX = 10;

/**
 * Long-press then drag across words to select a phrase, for touch input.
 *
 * A touch drag emits no `mouseup`, so the reader's mouse path never runs on a
 * phone. This owns the gesture instead of reading `window.getSelection()`, and
 * reports the first and last word of the run.
 *
 * `onPhrase` fires only for two or more words, because one word is a lookup.
 */
export function usePhraseTouchSelection(
  containerRef: RefObject<HTMLElement | null>,
  onPhrase: (first: HTMLElement, last: HTMLElement) => void,
) {
  const onPhraseRef = useRef(onPhrase);
  useEffect(() => {
    onPhraseRef.current = onPhrase;
  }, [onPhrase]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;
    let anchor: HTMLElement | null = null;
    let focus: HTMLElement | null = null;
    let spans: HTMLElement[] = [];
    let armed = false;

    const wordAt = (x: number, y: number): HTMLElement | null => {
      const element = document.elementFromPoint(x, y);
      return element ? (element.closest<HTMLElement>(WORD_SELECTOR) ?? null) : null;
    };

    const paint = () => {
      for (const span of spans) span.removeAttribute('data-phrase-dragging');
      if (!anchor || !focus) return;
      for (const span of wordSpansBetween(anchor, focus, spans)) {
        span.setAttribute('data-phrase-dragging', '');
      }
    };

    const reset = () => {
      if (holdTimer !== null) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      for (const span of spans) span.removeAttribute('data-phrase-dragging');
      anchor = null;
      focus = null;
      spans = [];
      armed = false;
    };

    const onTouchStart = (event: TouchEvent) => {
      reset();
      // A second finger is a pinch or a zoom, and never a phrase.
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const word = wordAt(touch.clientX, touch.clientY);
      const block = word?.closest(BLOCK_SELECTOR);
      if (!word || !block) return;
      startX = touch.clientX;
      startY = touch.clientY;
      anchor = word;
      // One block only. computePhraseHighlightSet matches inside a block, so a
      // run that crossed a paragraph would highlight nothing.
      spans = Array.from(block.querySelectorAll<HTMLElement>(WORD_SELECTOR));
      holdTimer = setTimeout(() => {
        holdTimer = null;
        armed = true;
        focus = anchor;
        paint();
      }, HOLD_MS);
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (!armed) {
        const moved =
          Math.abs(touch.clientX - startX) > SLOP_PX || Math.abs(touch.clientY - startY) > SLOP_PX;
        if (moved) reset();
        return;
      }
      // The listener is non-passive for this call: without it the page scrolls
      // out from under the drag.
      event.preventDefault();
      const word = wordAt(touch.clientX, touch.clientY);
      if (!word || !spans.includes(word) || word === focus) return;
      focus = word;
      paint();
    };

    const onTouchEnd = (event: TouchEvent) => {
      const selected = armed && anchor && focus ? wordSpansBetween(anchor, focus, spans) : [];
      reset();
      if (selected.length < 2) return;
      const first = selected[0];
      const last = selected[selected.length - 1];
      // A re-render mid-drag replaces the spans, and a Range over a detached
      // node throws.
      if (!first.isConnected || !last.isConnected) return;
      // No synthesized click, or the word under the finger opens as a lookup
      // and clears the phrase this just selected.
      event.preventDefault();
      onPhraseRef.current(first, last);
    };

    const onCancel = () => reset();
    // Both fire while the finger is still down. The gesture owns the press once
    // it is armed, so the browser must not also select or show a menu.
    const onNativeGesture = (event: Event) => {
      if (armed) event.preventDefault();
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onCancel);
    container.addEventListener('contextmenu', onNativeGesture);
    container.addEventListener('selectstart', onNativeGesture);

    return () => {
      reset();
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onCancel);
      container.removeEventListener('contextmenu', onNativeGesture);
      container.removeEventListener('selectstart', onNativeGesture);
    };
  }, [containerRef]);
}
