# Reader Sidebar Layout — Docked at lg, Bottom Sheet Mobile

## Context

The reader's translation drawer was previously docked as a sidebar only at the
`2xl` breakpoint (1536px+), sliding in from the right on all smaller screens.
This meant that on common laptop and tablet widths (1024–1535px) the drawer
took over the page as an overlay rather than living in a dedicated sidebar
column. The task was to extend the docked sidebar layout to `lg+` (1024px+),
convert the mobile drawer to a bottom sheet (≤45vh), and add click-outside-to-close.

## Files Affected

- `src/components/TranslationDrawer/slot.tsx` — breakpoint `2xl:flex` → `lg:flex`
- `src/components/TranslationDrawer/index.tsx` — docked breakpoint `2xl` → `md+`; mobile drawer repositioned from right-slide-in to bottom-sheet (≤45vh); added click-outside-to-close handler; added auto-scroll of clicked word above the bottom sheet; enabled Escape-to-close for docked mode (reader-page hook still takes priority via two-stage); fixed ignore button tooltip to show both keys
- `src/app/read/[bookId]/page.tsx` — layout wrapper `2xl:flex-row` → `lg:flex-row`; removed page-level Escape/S handlers that conflicted with the hook's two-stage Escape
- `e2e/reader-sidebar-layout.spec.ts` (new) — 5 e2e tests at 1280px (docked layout, Escape ordering) and 800px (bottom sheet, outside-click, word-switch, auto-scroll)
- `e2e/cloze-definitions.spec.ts` — updated `expectDrawerOpen`/`expectDrawerClosed` helpers for docked and bottom-sheet modes
- `e2e/translation-drawer.spec.ts` — bottom-sheet test now asserts `translate-y-*` classes
- `e2e/reader-copy.spec.ts` — Escape tests updated for two-stage Escape (two presses) and docked empty-state assertions
- `e2e/reader-keyboard-navigation.spec.ts` — "drawer is closed" and "second Escape" assertions updated for docked mode
- `e2e/reader-word-handling.spec.ts` — `translate-x-full` assertion replaced with empty-state check
- `e2e/nested-definitions.spec.ts` — `translate-x-full` assertion replaced with empty-state check
- `e2e/onboarding.spec.ts` — `translate-x-full` assertion replaced with empty-state check
- `e2e/practice.spec.ts` — `translate-x-full` assertion replaced with empty-state check

## Before / After

**Before:** Sidebar docked only at `2xl` (≥1536px). Below `2xl`, drawer was a
right-side slide-in panel with `sm:max-w-96` width cap. Close required Escape
or the Close button — clicking outside did nothing. The page-level keydown
handler closed the drawer on a single Escape, conflicting with the hook's
two-stage Escape. The ignore button tooltip only showed `X`.

**After:** Sidebar docks at `lg` (≥1024px). Below `lg`, drawer is a bottom
sheet (full-width, ≤45vh, slides up/down). Clicking outside the drawer and
outside word tokens closes the sheet. Clicking another word switches content
without flicker. The active word is auto-scrolled above the bottom sheet so it
isn't obscured. Escape on the reader page uses the hook's two-stage behavior
(first Escape clears selection, second returns to idle); the page-level Escape
handler was removed to avoid conflict. The ignore button tooltip shows
"X or I".

```typescript
// TranslationDrawer/index.tsx — docked now covers md+ (was 2xl only)
const docked = screenSize !== 'xs' && screenSize !== 'sm';

// Mobile drawer: bottom sheet instead of right-side slide
const idle = docked && (!rawIsOpen || !word.trim());
```

## Reasoning

The `lg` breakpoint (1024px) is the standard tablet/desktop threshold. Docking
the sidebar there matches the reader-page layout pattern used elsewhere in the
app and avoids the drawer obscuring content on most screens.

The bottom-sheet pattern on mobile is conventional and leaves the reader
content visible (peekable) when the drawer is open. The 45vh cap matches the
design from #289 §4.3.

Click-outside uses `pointerdown` (capture phase) so that a click on a word
token — which should switch the drawer content — is never intercepted as an
"outside" click. The handler checks `[data-testid="reader-word"]` (rendered by
WordCell with that default testid) to skip word-token targets.

Auto-scroll computes the overlap between the active word's bottom edge and the
45vh safe zone, then scrolls the nearest `.overflow-auto` ancestor by that
amount. This is simpler and more reliable than `scrollIntoView` with margins
(which doesn't trigger when the element is technically visible but covered).

The Escape two-stage behavior is handled by `useReaderKeyboardNavigation` on the
reader page (window capture listener with `stopPropagation`). Removing the
page-level Escape handler eliminates the conflict where the page handler would
close the drawer on the first Escape, overriding the hook's "clear selection first" step.

## Risks / Side Effects

- Existing e2e tests that asserted `translate-x-full` or `not.toBeVisible()` on
  the drawer at 1280px were updated to assert the idle empty state
  (`translation-drawer-empty`) instead, since the docked sidebar is always
  visible in the layout.
- The Escape-to-close handler on TranslationDrawer now fires in docked mode too.
  On the reader page it is shadowed by the hook (capture-phase on window with
  `stopPropagation`), so reader behavior is unchanged. On the practice page
  (no hook), a single Escape closes the drawer — this is the expected behavior
  there.
- The bottom-sheet position uses `inset-x-0 bottom-0` which is full-width on
  mobile. Some very wide phones in landscape may show a wide sheet; this matches
  the previous `w-full` behavior of the right-side panel.
