# Contributing to Lector

Thank you for a patch or a bug report.

## Issues and priority

Every issue gets one priority label. The labels are the backlog.

| Label | Meaning | Size of the set |
| --- | --- | --- |
| **P1** Do now | Outage, data loss, or a broken install. Drop other work. | Near zero. |
| **P2** Do soon | This cycle. A bug that users hit, or a small feature that unblocks a pack. | A handful. Not a parking lot. |
| **P3** Backlog | Wanted. No date. Epics live here until they shrink. | Most issues. |

Bugs default to P2. Features default to P3. A language pack, a new study mode, or a multi-week refactor is P3 until someone schedules it.

If an issue has no P label, it is not in the backlog yet. Add one.

Use the issue templates. Add `bug` or `enhancement`. Add `languages` or `Anki app` when that is the area.

## Development

You need Node.js 22 or later (see `.nvmrc`) and npm.

The app runs as two processes. The Next.js UI listens on port 3456. The Hono API listens on port 3457. Start each in its own terminal:

```bash
npm install
npm run dev:api
npm run dev
```

Open [http://localhost:3456](http://localhost:3456). The browser calls the API directly. There is no Next.js API proxy.

Copy `.env.example` to `.env.local` for keys. The app runs with no keys. The local dictionary covers common words.

### Tests

- Unit tests for UI logic: `npm test`
- Unit tests for the API: `cd api && bun test`
- End-to-end tests: `npm run test:e2e`

A new feature needs unit tests for the logic and Playwright coverage for the path that a user takes. See `AGENTS.md`.

### REST API document

`api/openapi.json` describes the HTTP API. A script writes that file. Do not edit it by hand.

```bash
npm run gen:openapi          # write api/openapi.json
npm run gen:openapi:check    # fail if a route has no entry
```

The generator reads `api/src/routes/registry.ts`. Prose and payload shapes come from `api/src/lib/openapi/annotations.ts`. Mount a new route module in `registry.ts`, never in `api/src/index.ts`. `bun test` in `api/` fails while a route has no entry.

### Folder structure

Break a large component into a folder:

```
components/TranslationDrawer/
    index.tsx
    utils.ts
    types.ts
    tests.ts
    components/
        Gloss/index.tsx
```

### Format

Format only the files that you touch:

```bash
npx prettier --write <touched-files...>
npx prettier --check <touched-files...>
```

Do not run a repository-wide format. The legacy tree is not fully normalized.

## Pull requests

Target `master` unless a maintainer names another branch. The GitHub text for a PR body must go through a file:

```bash
gh pr create --body-file /tmp/pr-body.md
```

Do not pass multiline Markdown with `--body`.

## License

A contribution is under the same AGPLv3 licence as the rest of the tree. See [LICENSE](LICENSE).
