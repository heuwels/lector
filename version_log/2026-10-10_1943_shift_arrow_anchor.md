# Fix Shift+Arrow Phrase Extension from Fixed Anchor

## Context

Shift+Arrow navigation was supposed to allow selecting a phrase (contiguous
range of words), but the implementation restarted the selection from the cursor
position on every Shift+Arrow press rather than extending from a fixed anchor.
For example, clicking word 1 then pressing Shift+Right twice would select
words 1–2 then 2–3, instead of extending from 1–2 to 1–2–3 as a text editor
does. Additionally, the drawer did not update to show the phrase translation as
the selection grew.

## Files Affected

- `src/components/MarkdownReader/useReaderKeyboardNavigation.ts`:
  - Added `anchorRef` (useRef) to track the shift-selection anchor position
  - Added `elementAt` helper to resolve an `ActiveReaderWord` position to its
    DOM element
  - On Shift+Arrow: set anchor to `prevCursor` (cursor before the move) on
    first press; subsequent presses keep the anchor fixed and move only the
    cursor; `wordSpansBetween(anchorEl, next, words)` builds the phrase from
    anchor to cursor; both `onSelectPhrase` (highlight) and `onLookUpWord`
    (drawer) are called with the phrase text
  - On plain Arrow: `anchorRef.current = null` before `onNavigate`
  - On Escape (first stage): `anchorRef.current = null` alongside
    `cursorRef.current = null`
  - On state-shortcut auto-advance: `anchorRef.current = null` after setting
    the new cursor position
  - In the `activeWord` sync effect: reset `anchorRef.current = null` on mouse
    click so each click starts a fresh selection
- `src/components/MarkdownReader/index.tsx`:
  - `onSelectPhrase` callback now clears `highlightedPhrase` when the phrase
    text tokenizes to fewer than 2 words (selection collapsed to a single word)

## Before / After

**Before:**
```typescript
if (event.shiftKey) {
  // currentEl = cursor after update = the word we just moved TO
  const span = wordSpansBetween(currentEl, next, words);
  callbacksRef.current.onSelectPhrase(text);
  // No onLookUpWord call — drawer not updated as selection grows
}
```

**After:**
```typescript
const prevCursor = cursorRef.current;
cursorRef.current = nextPos;
if (event.shiftKey) {
  if (!anchorRef.current) {
    anchorRef.current = prevCursor ?? nextPos;
  }
  const anchorEl = elementAt(anchorRef.current, words);
  if (anchorEl) {
    const span = wordSpansBetween(anchorEl, next, words);
    callbacksRef.current.onSelectPhrase(text);
    if (wordPanelOpen) {
      callbacksRef.current.onLookUpWord(text);
    }
  }
} else {
  anchorRef.current = null;
  // ...
}
```

## Reasoning

The fix mirrors standard text-editor shift-selection semantics: the anchor
stays at the initial position and the cursor moves. `wordSpansBetween` already
handles bidirectional ranges (anchor > focus and anchor < focus), so it works
for both Shift+Left and Shift+Right. Calling `onLookUpWord` with the phrase
text lets the drawer display the phrase translation as the user extends the
selection — previously the drawer stayed on the single word that was clicked.
The `onSelectPhrase` collapse fix ensures that when the selection shrinks to a
single word, the visual highlight is cleared rather than leaving a stale
multi-word highlight.

## Risks / Side Effects

- `onLookUpWord` is now called for every Shift+Arrow press when the drawer is
  open, which means a network lookup fires as the user extends the selection.
  This is the same behaviour as plain Arrow navigation (which also calls
  `onLookUpWord` on each press), so it is consistent.
- The phrase text is still built by joining `textContent` of word spans
  without inter-word spaces (`join('')`). For spaced-script languages this
  produces a concatenated string (e.g., "Diekat") that the tokenizer may not
  split correctly. This is a pre-existing limitation in the original
  Shift+Arrow implementation and is unchanged here.
