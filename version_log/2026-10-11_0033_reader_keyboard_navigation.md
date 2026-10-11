# Reader Keyboard Navigation

## Context

The reader page had no keyboard navigation between words — only mouse clicks
or Tab-to-button-Enter. This made rapid vocabulary building slow and
inaccessible. The feature request was to add arrow-key navigation, Shift+Arrow
phrase selection, Escape to clear selection, and k/x/1-4 state shortcuts with
auto-advance to the next word.

## Files Affected

- `src/components/WordCell/index.tsx` — added `blockId` and `wordIndex` props, rendered as `data-block-id` / `data-word-index` attributes; added `focus-visible:ring-2` style for keyboard focus
- `src/components/MarkdownReader/ReaderArticle/index.tsx` — passes `blockId` and `wordIndex` to each `WordCell`
- `src/components/MarkdownReader/useReaderKeyboardNavigation.ts` (new) — custom hook
- `src/components/MarkdownReader/index.tsx` — integrates the hook; added `onReaderStateShortcut` / `onReaderLookUpWord` props
- `src/components/MarkdownReader/types.ts` — added the two new callback props
- `src/app/read/[bookId]/page.tsx` — added `handleStateShortcut` / `handleLookUpWord`; removed k/x/1-4 from window-level handler
- `src/components/MarkdownReader/__tests__/useReaderKeyboardNavigation.test.ts` (new) — 8 unit tests
- `e2e/reader-keyboard-navigation.spec.ts` (new) — 9 e2e tests
- `e2e/reader-word-handling.spec.ts` — updated `Cmd+number` test for auto-advance

## Before / After

**Before:** No keyboard navigation existed. Users had to click each word to look
it up, and state assignment required clicking buttons in the drawer.

**After:** Arrow keys move focus between reader words. Shift+Arrow selects a
phrase range. Escape clears the active-word highlight. When the drawer is open,
k/x/1-4 assign vocab state and automatically advance to the next word and
trigger a lookup for it.

```typescript
// useReaderKeyboardNavigation.ts — the hook queries DOM attributes
// data-block-id / data-word-index on WordCell spans
export function useReaderKeyboardNavigation(
  containerRef: RefObject<HTMLElement | null>,
  wordPanelOpen: boolean,
  hasActiveSelection: boolean,
  callbacks: NavigationCallbacks,
);
```

## Reasoning

The hook queries the rendered DOM for `[data-word-state]` elements with
`data-block-id` / `data-word-index` attributes, so it stays in sync with
what's actually on screen regardless of article content. WordCell now renders
these attributes, enabling O(n) DOM queries for the next/previous word in
document order.

Auto-advance runs asynchronously after `onStateShortcut` resolves (the
state-assignment functions are async with API calls), so the drawer properly
closes for the current word before reopening for the next.

## Risks / Side Effects

- The keydown listener is attached to `window` (not the container) so it fires
  regardless of focus location (reader word, body, or portaled drawer).
- The window-level k/x/1-4/escape/s handler was replaced by the hook. If the
  hook is not active (callbacks not provided), these keys have no effect.
- The existing `Cmd+number` test was updated: pressing `1` now auto-advances the
  drawer to the next word, so the test checks `data-word-state` on the word
  chip rather than the drawer's level button ring.
- `parseWordElement` accepts a duck-typed `{ getAttribute }` param instead of
  `HTMLElement`, so it's unit-testable in the node environment without jsdom.

### Fix: Listener moved to window (2026-10-11 01:00)

The initial implementation attached the keydown listener to the reader
container. This was broken because:

1. **Focus in the drawer**: The translation drawer is portaled to
   `document.body` via `createPortal(content, document.body)`, so keydown
   events from drawer buttons never reach the container listener.
2. **Focus on body**: When focus is on `<body>` (e.g., after clicking page
   margin), the container listener also misses the event.

**Fix**: moved the listener to `window` with `{ capture: true }`. The hook
still queries `containerRef.current` for word spans (DOM queries are fine —
the container is always rendered), but the event listener is global.

**Persistent cursor**: Added `cursorRef` that tracks the keyboard-selected
word across keydowns. It syncs from `activeWord` whenever the user clicks a
word (so mouse and keyboard agree). Arrow presses move the cursor, and the
cursor is used as the starting point for the next arrow press instead of
falling back to the first word.

**Up/Down via geometry**: `ArrowUp` and `ArrowDown` use
`getBoundingClientRect()` to group words by visual line (rounded to a 4px
grid), then find the word on the adjacent line whose horizontal center is
closest to the current word. This follows text wrapping, not DOM order.

**State shortcut aliases**: `i` added alongside `x` for ignore. Both map to
`'ignored'` in `STATE_SHORTCUTS`.

**Escape order**: First Escape clears the active-word/phrase highlight
(cursor + activeWord + highlightedPhrase); second Escape (when cursor is null)
closes the drawer via `onReaderCloseDrawer`. This is a behavior change from the
original single-Escape-close.

**Original key mapping restored from git history** (commit `9af43cd`):

- `k` → `markAsKnown()` + auto-advance
- `x` / `i` → `ignoreWord()` + auto-advance
- `s` → `saveWordToVocab()` (only when `!existingEntry && translation`)
- `1-4` → `setWordLevel(n)` + auto-advance

Key matching is now case-insensitive (`event.key.toLowerCase()`) to match the
original `e.key.toLowerCase()` pattern.

New props added to support window-level dispatch:

- `onReaderCloseDrawer` (Escape → closeWordPanel)
- `onReaderSaveWord` ('s' → saveWordToVocab, with original guard conditions)
- `onReaderStateShortcut` (k/x/i/1-4 → state assignment + auto-advance)
- `onReaderLookUpWord` (auto-advance → trigger lookup for next word)
