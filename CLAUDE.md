# Claude Instructions

**IMPORTANT: Before raising any PR, the full e2e test suite must pass locally with 0 failures. Run `npx playwright test` and verify all tests pass. This is mandatory — CI is unreliable, local verification is the source of truth.**

## Testing Requirements

Every new feature MUST be accompanied by:
- **Unit tests** covering the API/logic layer (if applicable)
- **E2E tests** (Playwright) covering:
  - The happy path (full user journey)
  - Edge cases (empty states, error handling, boundary conditions)

Tests live in:
- `e2e/` - Playwright end-to-end tests
- Run with: `npm run test:e2e`

## Tech Stack

- Next.js 16 + React 19
- Tailwind CSS v4 (class-based dark mode via `@custom-variant`)
- SQLite (better-sqlite3) for server-side data
- Dexie (IndexedDB) for client-side vocab
- No component library — custom components throughout

## Key Patterns

- Pages use `NavHeader` component for sidebar/bottom nav
- Desktop sidebar is 56 units wide (`sm:ml-56` on page wrapper)
- Dark mode uses `.dark` class on `<html>`, toggled via `ThemeToggle`
- Practice page has type and MC modes with a fallback MC option
- SRS intervals: 0/1/3/7/14 days for mastery levels 0/25/50/75/100
