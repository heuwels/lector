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

CI runs all of these, plus the e2e suite a second time against the production Docker image (`E2E_EXTERNAL_SERVER=1` with the container mapped to :3456 for the UI and :3457 for the Hono API the browser calls directly) to cover the standalone build and `docker-entrypoint.sh`. That e2e image is the amd64 image that a merge to master publishes. The workflow applies a new tag to it. It does not build it again.

## API Documentation

`api/openapi.json` is generated from the route table, and it must stay complete.

- Mount a new route module in `api/src/routes/registry.ts`, never in `api/src/index.ts`.
- Add one entry per endpoint to `api/src/lib/openapi/annotations.ts`, keyed `"<METHOD> <path>"`.
- Run `npm run gen:openapi` and commit `api/openapi.json` with the change.

`bun test` in `api/` fails while a route has no entry, or while the committed
document is stale. The document holds only the endpoints a personal access token
can reach. The scope map in `api/src/lib/auth.ts` decides that set.

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

# Repository instructions for coding agents

## Formatting

- `.editorconfig` and `.prettierrc` are the canonical shared formatting settings.
- Install dependencies from `package-lock.json`; the repository pins Prettier and its Tailwind plugin so every agent uses the same formatter implementation.
- Format only files changed for the current task: `npx prettier --write <touched-files...>`.
- Do not run repository-wide formatting during a feature or fix. The legacy tree is not yet fully normalized, so doing so creates unrelated review churn.
- Before handing off, run `npx prettier --check <touched-files...>` and `git diff --check`.
- A future formatting-only baseline change should normalize the whole tree before `npm run format:check` becomes a required CI gate.

## Code Comments

Write no comment by default. To test one, delete it. Then ask whether a competent reader can still get this code right. Keep the comment only when the answer is no. This test covers a doc comment as much as a `//` line.

- One comment states one fact, in two lines at most. A third line means the code needs a better name or a smaller function.
- A comment earns its place only when it records what the code cannot show:
  - a contract that a caller must honour
  - an invariant that ties two places together
  - a unit, or a magic value
  - a quirk in an external system, or in a data source
  - a mirrored file that must stay in step
- Do not editorialise. Cut every word that argues instead of informs. Cut capitals used for emphasis. `Deliberately not a loop` and `the whole point of` give a reader nothing to act on.
- Do not write the history of the change into the code. Put that in the commit message or the PR. A comment must not record:
  - how you reached the answer
  - what the code was before
  - which bug it closed
  - what a measurement showed
  - what a reviewer asked for
- An issue number is not a reason to add a comment. Add one only inside a comment that already earns its place.
- These rules beat local convention. Much of this tree is over-commented, so follow the rule and not the neighbours.
- Apply this to comments you write or change. Leave unrelated comments alone, for the reason `## Formatting` gives against repository-wide reformatting.

## GitHub text

- Always use an input file for multiline PR bodies and comments: `gh pr create/edit --body-file …` and `gh pr comment --body-file …`. Never embed escaped `\n` sequences in `--body`.

## Public README

`README.md` is the product page for GitHub and for self-hosters. Keep it current.

Update `README.md` in the same change when you:

- add or remove a feature that a user sees. This includes the reader, cloze, Anki, the tutor, import, and listen.
- add or remove a language pack, or change what a pack includes
- change deploy: image name, ports, Compose services, or a required env var
- change auth, `LECTOR_MODE`, backups, or the adopt-local-data flow

Do not put agent-only or contributor-only material in `README.md`. Put the folder styleguide, OpenAPI generation, and the local two-process setup in `CONTRIBUTING.md`. Put long operator notes in `deploy/README.md`.

Lead with Docker Compose. Do not lead with `npm run`. Do not describe Lector as an Afrikaans-only reader. Afrikaans is the first language pack, not the product.

After a README edit, run the STE linter on `README.md`, `CONTRIBUTING.md`, and `deploy/README.md`.
