# Claude Instructions

**Testing policy: CI runs the full e2e suite on every PR — rely on it for PR verification, and locally run the specs your change touches (plus `npm test` for unit tests).**

## Testing Requirements

Every new feature MUST be accompanied by:
- **Unit tests** covering the API/logic layer (if applicable)
- **E2E tests** (Playwright) covering:
  - The happy path (full user journey)
  - Edge cases (empty states, error handling, boundary conditions)

Tests live in:
- `src/**/*.test.ts` - vitest unit tests — run with `npm test`
- `api/src/**/*.test.ts` - bun:test unit tests — run with `cd api && bun test` (vitest excludes `api/**`; don't mix the two runners)
- `e2e/` - Playwright end-to-end tests — run with `npm run test:e2e` (boots both servers against an isolated `tmp/e2e-data`, never the real `data/`)

CI runs all of these, plus the e2e suite a second time against the production Docker image (`E2E_EXTERNAL_SERVER=1` with the container mapped to :3456) to cover the standalone build and `docker-entrypoint.sh`.

## Tech Stack

- Next.js 16 + React 19
- Tailwind CSS v4 (class-based dark mode via `@custom-variant`)
- SQLite (better-sqlite3) for server-side data; the client persists everything through the API routes (`src/lib/data-layer.ts`)
- No component library — custom components throughout

## Key Patterns

- Pages use `NavHeader` component for sidebar/bottom nav
- Desktop sidebar is 56 units wide (`sm:ml-56` on page wrapper)
- Dark mode uses `.dark` class on `<html>`, toggled via `ThemeToggle`
- Practice page has type and MC modes with a fallback MC option

## SRS Behaviour (implemented in `src/app/practice/page.tsx`)

- Intervals: 0/1/3/7/14 days for mastery levels 0/25/50/75/100, scheduled at the exact review time (no midnight flooring). Mastery-100 cards keep a 14-day maintenance review and are served when due.
- Correct answers move up one level (+25). A miss hard-resets the card to mastery 0 and re-queues it at the end of the round; the retry runs from mastery 0 and awards no points (the answer was just shown).
- Cloze words from the bank can carry trailing punctuation — always strip via `splitTrailingPunctuation` (`src/lib/words.ts`) before matching, displaying, or persisting them.

## Dates, Streaks & Time Zone

- Day rollover (daily stats, streaks, review days) uses the `timezone` setting (Settings → Time Zone), falling back to the server's zone — never raw UTC. Helpers: `src/lib/server/dates.ts` / `api/src/lib/dates.ts` (`getTodayDate()`), pure math in `src/lib/dates.ts`.
- One streak definition app-wide: a day is active if it has any dictionary lookups, cloze practice, or reading minutes. Computed by `computeStreaks` (`src/lib/streak.ts`, mirrored in `api/src/lib/streak.ts`), served by `/api/stats/streak` (current + longest). Pages must not compute their own streaks.
- The pure helpers are mirrored between `src/lib/` and `api/src/lib/` (the servers share the SQLite file but not source) — keep both copies in sync when editing.
