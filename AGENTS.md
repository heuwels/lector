# Agent Instructions

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

CI runs all of these, plus the e2e suite a second time against the production Docker image (`E2E_EXTERNAL_SERVER=1` with the container mapped to :3456 for the UI and :3457 for the Hono API the browser calls directly) to cover the standalone build and `docker-entrypoint.sh`.

## Tech Stack

- Next.js 16 + React 19 — the front-end. It serves the UI only: no database, and **no `/api/*` routes** (the Next→Hono proxy was removed in #188).
- Hono on Bun is the API backend (`api/`), using Bun's native `bun:sqlite`. The browser talks to it **directly** — `src/lib/data-layer.ts` and the other client fetchers route every call through `apiFetch`/`apiUrl` from `src/lib/api-base.ts`, which reads the API origin from `window.__ENV__.API_URL`. That's injected at container start by `docker-entrypoint.sh` from the runtime `API_URL` env (written to `/__env.js`), since `NEXT_PUBLIC_*` bakes at build and can't be set on a prebuilt image; it falls back to `http://localhost:3457` for dev. The cross-origin calls rely on Hono's `app.use('*', cors())`. (better-sqlite3 survives only as a devDependency, for the `scripts/build-dictionary.ts` / `export-cached-entries.ts` tooling.)
- Tailwind CSS v4 (class-based dark mode via `@custom-variant`)
- shadcn/ui (Base UI primitives, `base-vega` style, zinc tokens) is initialized — add primitives with `npx shadcn@latest add <component>` into `src/components/ui/` and extend them there. Adoption is gradual: prefer `ui/` components in new/touched code, don't hand-roll buttons/dialogs/menus, and don't mass-migrate existing ones

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

- Day rollover (daily stats, streaks, review days) uses the `timezone` setting (Settings → Time Zone), falling back to the server's zone — never raw UTC. Server helper: `api/src/lib/dates.ts` (`getTodayDate()`); pure client-side math in `src/lib/dates.ts`.
- One streak definition app-wide: a day is active if it has any dictionary lookups, cloze practice, or reading minutes. Computed by `computeStreaks` (`src/lib/streak.ts`, mirrored in `api/src/lib/streak.ts`), served by `/api/stats/streak` (current + longest). Pages must not compute their own streaks.
- Pure helpers used on both sides (e.g. `dates`, `streak`, `stats-derive`) are mirrored between the client `src/lib/` copy and the Hono `api/src/lib/` copy — keep them in sync when editing. The Hono API owns the DB; the client copies are for rendering only.