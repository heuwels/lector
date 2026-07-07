// Refuses to run destructive tests against a real database. Every test file
// that DELETEs from whole tables imports this FIRST, so it throws before any
// module touches the DB. `bun run test` isolates DATA_DIR=.test-data (see
// package.json); bare `bun test` inherits the shell env, which points db.ts
// at the real data/ directory — a mistake that has already wiped a live DB
// once. Fail loudly instead of trusting everyone to remember.
const dataDir = process.env.DATA_DIR || '';
if (!dataDir.includes('.test-data')) {
  throw new Error(
    'Destructive test refused: DATA_DIR is not an isolated .test-data dir. ' +
      'Run tests via `bun run test` (never bare `bun test` — it would hit the real data/ DB).',
  );
}
export {};
