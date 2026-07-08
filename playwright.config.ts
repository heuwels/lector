import { defineConfig, devices } from "@playwright/test";
import { API_BASE } from "./e2e/api";

// E2E_EXTERNAL_SERVER=1 — the app is already running at localhost:3456 (e.g.
// the production Docker image with `-p 3456:3000 -p 3457:3457`) and Playwright
// must not spawn the dev servers. The server must be FRESH: several specs
// assert empty-DB state, which `webServer` otherwise guarantees by wiping
// tmp/e2e-data. The UI specs hardcode the localhost:3456 origin; the API (the
// browser client + the specs' page.request calls) defaults to localhost:3457,
// overridable via E2E_API_URL, now that the Next /api proxy is gone (#188), so
// the external server must publish BOTH ports — a different UI origin is not
// supported.
const externalServer = !!process.env.E2E_EXTERNAL_SERVER;

// Port the Hono webServer binds to in dev mode, derived from API_BASE so the
// whole suite is driven by one knob (E2E_API_URL; default http://localhost:3457).
const apiPort = new URL(API_BASE).port || "3457";

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
    // Set language in localStorage so SetupGuard doesn't redirect tests to
    // /setup. Selfhost only: the app migrates this legacy key onto the
    // tenant-keyed cache (#281); cloud-mode specs ignore it by design — their
    // accounts onboard via /setup (or seed the server setting) per test.
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
      // Hono API — the browser client and the specs' page.request calls hit it
      // directly now that the Next /api proxy is gone (#188). Bound to the port
      // from API_BASE (E2E_API_URL) so the whole suite uses one knob. Started
      // without --watch so it shuts down cleanly when Playwright exits.
      command: "bun run src/index.ts",
      cwd: "./api",
      url: `${API_BASE}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATA_DIR: "../tmp/e2e-data", PORT: apiPort },
    },
    {
      // A SECOND Hono API in CLOUD mode (#218) for the auth-cloud specs. Own
      // isolated DATA_DIR; emails written to a file the specs read the
      // verification/reset links back out of. The UI is the same :3456 next
      // dev — auth-cloud.spec.ts stubs window.__ENV__ per page to point the
      // browser at this API and flip the client into cloud mode.
      command:
        "rm -rf ../tmp/e2e-data-cloud && mkdir -p ../tmp/e2e-data-cloud && bun run src/index.ts",
      cwd: "./api",
      url: "http://localhost:3462/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATA_DIR: "../tmp/e2e-data-cloud",
        PORT: "3462",
        LECTOR_MODE: "cloud",
        BETTER_AUTH_SECRET: "e2e-only-secret-0123456789abcdef",
        BETTER_AUTH_URL: "http://localhost:3462",
        LECTOR_TRUSTED_ORIGINS: "http://localhost:3456",
        EMAIL_FILE: "../tmp/e2e-data-cloud/emails.jsonl",
      },
    },
    {
      // A THIRD Hono API in cloud mode (#218/#220) for the two-user isolation
      // spec. Its own fresh DATA_DIR (Better Auth tables + tenant rows), file
      // email outbox (the spec reads verification links from it), and the
      // default trusted origins already cover the :3456 UI. The UI is served
      // by the same Next dev server as everything else — the spec points the
      // browser here by injecting window.__ENV__ per context. Not booted (and
      // the spec skips) under E2E_EXTERNAL_SERVER.
      command: "rm -rf ../tmp/e2e-cloud-data && mkdir -p ../tmp/e2e-cloud-data && bun run src/index.ts",
      cwd: "./api",
      url: "http://localhost:3467/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATA_DIR: "../tmp/e2e-cloud-data",
        PORT: "3467",
        LECTOR_MODE: "cloud",
        BETTER_AUTH_SECRET: "e2e-only-secret-0000000000000000",
        BETTER_AUTH_URL: "http://localhost:3467",
        EMAIL_FILE: "../tmp/e2e-cloud-data/outbox.jsonl",
      },
    },
    {
      // A FOURTH cloud-mode API with the Paddle billing gate armed (#224) for
      // billing-cloud.spec.ts: no free tier, so a fresh verified account must
      // land locked on /subscribe until the spec plays Paddle and posts signed
      // webhooks at it. No PADDLE_CLIENT_TOKEN on purpose — e2e asserts OUR
      // gate + webhook + unlock, never Paddle's hosted overlay.
      command: "rm -rf ../tmp/e2e-billing-data && mkdir -p ../tmp/e2e-billing-data && bun run src/index.ts",
      cwd: "./api",
      url: "http://localhost:3469/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATA_DIR: "../tmp/e2e-billing-data",
        PORT: "3469",
        LECTOR_MODE: "cloud",
        BETTER_AUTH_SECRET: "e2e-only-secret-1111111111111111",
        BETTER_AUTH_URL: "http://localhost:3469",
        LECTOR_TRUSTED_ORIGINS: "http://localhost:3456",
        EMAIL_FILE: "../tmp/e2e-billing-data/emails.jsonl",
        LECTOR_BILLING: "paddle",
        PADDLE_WEBHOOK_SECRET: "e2e-paddle-webhook-secret",
      },
    },
  ],
});
