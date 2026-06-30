import { defineConfig, devices } from "@playwright/test";

// E2E_EXTERNAL_SERVER=1 — the app is already running at localhost:3456 (e.g.
// the production Docker image with `-p 3456:3000 -p 3457:3457`) and Playwright
// must not spawn the dev servers. The server must be FRESH: several specs
// assert empty-DB state, which `webServer` otherwise guarantees by wiping
// tmp/e2e-data. The UI specs hardcode the localhost:3456 origin and the API
// (the browser client + the specs' page.request calls) is hardcoded to
// localhost:3457 now that the Next /api proxy is gone (#188), so the external
// server must publish BOTH ports — a different origin is not supported.
const externalServer = !!process.env.E2E_EXTERNAL_SERVER;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3456",
    trace: "on-first-retry",
    // Set language in localStorage so SetupGuard doesn't redirect tests to /setup
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:3456",
          localStorage: [{ name: "lector-target-language", value: "af" }],
        },
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Both servers run against an isolated DATA_DIR so the suite never touches
  // the real data/lector.db (#110). reuseExistingServer is off for the same
  // reason: an already-running dev server would be using the real data dir.
  webServer: externalServer ? undefined : [
    {
      // Fresh DB every run — several specs assert empty-DB state (e.g.
      // fluency expects totalKnownWords 0). The dictionary is re-copied since
      // it's read-only test input. The Bun API opens the DB lazily, so there
      // is no startup race with this wipe.
      command:
        "rm -rf tmp/e2e-data && mkdir -p tmp/e2e-data && (cp data/dictionary-*.db tmp/e2e-data/ 2>/dev/null || true) && npm run dev",
      url: "http://localhost:3456",
      reuseExistingServer: false,
      env: { DATA_DIR: "tmp/e2e-data" },
    },
    {
      // Hono API on :3457 — the browser client and the specs' page.request
      // calls hit it directly now that the Next /api proxy is gone (#188).
      // Started without --watch so it shuts down cleanly when Playwright exits.
      command: "bun run src/index.ts",
      cwd: "./api",
      url: "http://localhost:3457/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATA_DIR: "../tmp/e2e-data" },
    },
  ],
});
