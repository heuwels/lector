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
// Under the ~8 px touch slop of both engines: once an engine starts a scroll it
// marks touchmove non-cancelable, and the gesture must give up before then.
const SLOP_PX = 8;

/**
 * Long-press then drag across words to select a phrase, for touch input.
 *
 * A touch drag emits no `mouseup`, so the reader's mouse path never runs on a
 * phone. This owns the gesture instead of reading `window.getSelection()`, and
 * reports the first and last word of the run.
 *
 * `onPhrase` fires only for two or more words. A hold on one word clicks that
 * word, which routes it through the ordinary single-word lookup.
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
    let paintTimer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;
    let anchor: HTMLElement | null = null;
    let focus: HTMLElement | null = null;
    let spans: HTMLElement[] = [];
    let armed = false;
    // A click that the browser makes from this gesture must not reach WordCell:
    // its handler clears the phrase and looks up the one word under the finger.
    let swallowClick = false;

    const wordAt = (x: number, y: number): HTMLElement | null => {
      const element = document.elementFromPoint(x, y);
      return element ? (element.closest<HTMLElement>(WORD_SELECTOR) ?? null) : null;
    };

    const unpaint = (targets: readonly HTMLElement[]) => {
      for (const span of targets) span.removeAttribute('data-phrase-dragging');
    };

    const paint = () => {
      unpaint(spans);
      if (!anchor || !focus) return;
      for (const span of wordSpansBetween(anchor, focus, spans)) {
        span.setAttribute('data-phrase-dragging', '');
      }
    };

    // Non-passive, so `preventDefault` below can hold the page still. Bound at
    // touchstart rather than for the life of the reader, or every scroll in the
    // lesson waits on the main thread. Not bound at the hold instead: a browser
    // marks touchmove non-cancelable once a scroll has started, and by then
    // `preventDefault` is a no-op.
    const armedMove = (event: TouchEvent) => {
      if (!armed) return;
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      const word = wordAt(touch.clientX, touch.clientY);
      if (!word || !spans.includes(word) || word === focus) return;
      focus = word;
      paint();
    };

    const endGesture = () => {
      if (holdTimer !== null) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      container.removeEventListener('touchmove', armedMove);
      anchor = null;
      focus = null;
      spans = [];
      armed = false;
    };

    const reset = () => {
      unpaint(spans);
      endGesture();
    };

    const onTouchStart = (event: TouchEvent) => {
      reset();
      swallowClick = false;
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
      container.addEventListener('touchmove', armedMove, { passive: false });
      holdTimer = setTimeout(() => {
        holdTimer = null;
        armed = true;
        focus = anchor;
        paint();
      }, HOLD_MS);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (armed) return;
      const touch = event.touches[0];
      if (!touch) return;
      const moved =
        Math.abs(touch.clientX - startX) > SLOP_PX || Math.abs(touch.clientY - startY) > SLOP_PX;
      if (moved) reset();
    };

    const onTouchEnd = (event: TouchEvent) => {
      const selected = armed && anchor && focus ? wordSpansBetween(anchor, focus, spans) : [];
      const first = selected[0];
      const last = selected[selected.length - 1];
      // A re-render mid-drag replaces the spans, and a Range over a detached
      // node throws.
      const live = selected.length > 0 && first.isConnected && last.isConnected;

      if (selected.length === 1 && live) {
        // A hold on one word is a lookup. Click it rather than wait for the
        // click a tap makes: iOS often sends none after a long press.
        reset();
        event.preventDefault();
        first.click();
        return;
      }

      if (selected.length < 2 || !live) {
        reset();
        return;
      }

      // Keep the drag paint until React has drawn the committed highlight, or
      // one frame draws with neither. Both paints use the same colour.
      const painted = selected;
      endGesture();
      paintTimer = setTimeout(() => {
        paintTimer = null;
        unpaint(painted);
      }, 0);

      swallowClick = true;
      event.preventDefault();
      onPhraseRef.current(first, last);
    };

    // Capture, so the event never reaches React's root listener and WordCell.
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const onCancel = () => reset();
    // Both fire while the finger is still down. The gesture owns the press once
    // it is armed, so the browser must not also select or show a menu.
    const onNativeGesture = (event: Event) => {
      if (armed) event.preventDefault();
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onCancel);
    container.addEventListener('click', onClick, { capture: true });
    container.addEventListener('contextmenu', onNativeGesture);
    container.addEventListener('selectstart', onNativeGesture);
    // Passive: this one only measures the slop, and it must not cost a scroll.
    container.addEventListener('touchmove', onTouchMove, { passive: true });

    return () => {
      reset();
      if (paintTimer !== null) clearTimeout(paintTimer);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onCancel);
      container.removeEventListener('click', onClick, { capture: true });
      container.removeEventListener('contextmenu', onNativeGesture);
      container.removeEventListener('selectstart', onNativeGesture);
      container.removeEventListener('touchmove', onTouchMove);
    };
  }, [containerRef]);
}
