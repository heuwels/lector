import { defineConfig, devices } from '@playwright/test';
import { API_BASE } from './e2e/api';

// E2E_EXTERNAL_SERVER=1 — the app is already running at localhost:3456 (e.g.
// the production Docker image with `-p 3456:3000 -p 3457:3457`) and Playwright
// must not spawn the dev servers. The server must be FRESH: several specs
// assert empty-DB state, which `webServer` otherwise guarantees by wiping
// tmp/e2e-data. The UI defaults to localhost:3456 (overridable with
// E2E_UI_PORT); the API defaults to localhost:3457 (overridable with
// E2E_API_URL), now that the Next /api proxy is gone (#188). An external server
// must publish both configured ports.
const externalServer = !!process.env.E2E_EXTERNAL_SERVER;

// Port the Hono webServer binds to in dev mode, derived from API_BASE so the
// whole suite is driven by one knob (E2E_API_URL; default http://localhost:3457).
const apiPort = new URL(API_BASE).port || '3457';

// UI port knob (E2E_UI_PORT, default 3456) so the suite can run from a
// parallel clone while another lector dev server holds 3456. Specs navigate
// baseURL-relative, so this one constant carries the whole UI origin.
const uiPort = process.env.E2E_UI_PORT || '3456';
const uiOrigin = `http://localhost:${uiPort}`;

// Dedicated cloud-test ports are independently overridable so parallel clones
// can run the full suite without sharing databases or attaching to each
// other's APIs. Keep these names in sync with the cloud specs below.
const authApiPort = process.env.E2E_AUTH_API_PORT || '3462';
const isolationApiPort = process.env.E2E_ISOLATION_API_PORT || '3467';
const billingApiPort = process.env.E2E_BILLING_API_PORT || '3469';
const adminApiPort = process.env.E2E_ADMIN_API_PORT || '3471';
const freeApiPort = process.env.E2E_FREE_API_PORT || '3473';
const authApiOrigin = `http://localhost:${authApiPort}`;
const isolationApiOrigin = `http://localhost:${isolationApiPort}`;
const billingApiOrigin = `http://localhost:${billingApiPort}`;
const adminApiOrigin = `http://localhost:${adminApiPort}`;
const freeApiOrigin = `http://localhost:${freeApiPort}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: uiOrigin,
    trace: 'on-first-retry',
    // Set language in localStorage so SetupGuard doesn't redirect tests to
    // /setup. Selfhost only: the app migrates this legacy key onto the
    // tenant-keyed cache (#281); cloud-mode specs ignore it by design — their
    // accounts onboard via /setup (or seed the server setting) per test.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: uiOrigin,
          localStorage: [{ name: 'lector-target-language', value: 'af' }],
        },
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Both servers run against an isolated DATA_DIR so the suite never touches
  // the real data/lector.db (#110). reuseExistingServer is off for the same
  // reason: an already-running dev server would be using the real data dir.
  webServer: externalServer
    ? undefined
    : [
        {
          // Fresh DB every run — several specs assert empty-DB state (e.g.
          // fluency expects totalKnownWords 0). The dictionary is re-copied since
          // it's read-only test input. The Bun API opens the DB lazily, so there
          // is no startup race with this wipe.
          command: `rm -rf tmp/e2e-data && mkdir -p tmp/e2e-data && (cp data/dictionary-*.db tmp/e2e-data/ 2>/dev/null || true) && npx next dev --port ${uiPort}`,
          url: uiOrigin,
          reuseExistingServer: false,
          env: { DATA_DIR: 'tmp/e2e-data' },
        },
        {
          // Hono API — the browser client and the specs' page.request calls hit it
          // directly now that the Next /api proxy is gone (#188). Bound to the port
          // from API_BASE (E2E_API_URL) so the whole suite uses one knob. Started
          // without --watch so it shuts down cleanly when Playwright exits.
          command: 'bun run src/index.ts',
          cwd: './api',
          url: `${API_BASE}/health`,
          reuseExistingServer: false,
          timeout: 60_000,
          env: {
            DATA_DIR: '../tmp/e2e-data',
            PORT: apiPort,
            // Fixture starter pack for the seeding specs (#315) — a relative path
            // resolved against this server's cwd (./api). Real packs ship none yet;
            // starter-content.spec.ts skips its fixture-dependent tests under
            // E2E_EXTERNAL_SERVER, where this env (and the fixture) is absent.
            STARTER_CONTENT_ROOT: '../e2e/fixtures/starter-content',
          },
        },
        {
          // A SECOND Hono API in CLOUD mode (#218) for the auth-cloud specs. Own
          // isolated DATA_DIR; emails written to a file the specs read the
          // verification/reset links back out of. The UI is the same :3456 next
          // dev — auth-cloud.spec.ts stubs window.__ENV__ per page to point the
          // browser at this API and flip the client into cloud mode.
          command:
            'rm -rf ../tmp/e2e-data-cloud && mkdir -p ../tmp/e2e-data-cloud && bun run src/index.ts',
          cwd: './api',
          url: `${authApiOrigin}/health`,
          reuseExistingServer: false,
          timeout: 60_000,
          env: {
            DATA_DIR: '../tmp/e2e-data-cloud',
            PORT: authApiPort,
            LECTOR_MODE: 'cloud',
            BETTER_AUTH_SECRET: 'e2e-only-secret-0123456789abcdef',
            BETTER_AUTH_URL: authApiOrigin,
            LECTOR_TRUSTED_ORIGINS: uiOrigin,
            EMAIL_FILE: '../tmp/e2e-data-cloud/emails.jsonl',
          },
        },
        {
          // A THIRD Hono API in cloud mode (#218/#220) for the two-user isolation
          // spec. Its own fresh DATA_DIR (Better Auth tables + tenant rows), file
          // email outbox (the spec reads verification links from it), and the
          // default trusted origins already cover the shared UI. The UI is served
          // by the same Next dev server as everything else — the spec points the
          // browser here by injecting window.__ENV__ per context. Not booted (and
          // the spec skips) under E2E_EXTERNAL_SERVER.
          command:
            'rm -rf ../tmp/e2e-cloud-data && mkdir -p ../tmp/e2e-cloud-data && bun run src/index.ts',
          cwd: './api',
          url: `${isolationApiOrigin}/health`,
          reuseExistingServer: false,
          timeout: 60_000,
          env: {
            DATA_DIR: '../tmp/e2e-cloud-data',
            PORT: isolationApiPort,
            LECTOR_MODE: 'cloud',
            BETTER_AUTH_SECRET: 'e2e-only-secret-0000000000000000',
            BETTER_AUTH_URL: isolationApiOrigin,
            EMAIL_FILE: '../tmp/e2e-cloud-data/outbox.jsonl',
          },
        },
        {
          // A FOURTH cloud-mode API with the Paddle billing gate armed (#224) for
          // billing-cloud.spec.ts: no free tier, so a fresh verified account must
          // land locked on /subscribe until the spec plays Paddle and posts signed
          // webhooks at it. No CHECKOUT_URL, so the screen shows its graceful
          // fallback (the monthly price below only maps webhooks → the 'cloud'
          // plan, per the note there) — e2e asserts OUR gate + webhook + unlock,
          // never Paddle itself (checkout is created server-side, opens on lector.dev,
          // driven here via a mocked /api/billing/checkout).
          command:
            'rm -rf ../tmp/e2e-billing-data && mkdir -p ../tmp/e2e-billing-data && bun run src/index.ts',
          cwd: './api',
          url: `${billingApiOrigin}/health`,
          reuseExistingServer: false,
          timeout: 60_000,
          env: {
            DATA_DIR: '../tmp/e2e-billing-data',
            PORT: billingApiPort,
            LECTOR_MODE: 'cloud',
            BETTER_AUTH_SECRET: 'e2e-only-secret-1111111111111111',
            BETTER_AUTH_URL: billingApiOrigin,
            LECTOR_TRUSTED_ORIGINS: uiOrigin,
            EMAIL_FILE: '../tmp/e2e-billing-data/emails.jsonl',
            LECTOR_BILLING: 'paddle',
            PADDLE_WEBHOOK_SECRET: 'e2e-paddle-webhook-secret',
            // Required at boot when billing is armed (a real key creates checkout
            // transactions). The suite never clicks through to Paddle — the
            // checkout redirect is exercised against a mocked /api/billing/checkout.
            PADDLE_API_KEY: 'pdl_e2e_dummy',
            // The webhook fixtures subscribe with this price, mapping entitled
            // accounts to the 'cloud' plan for plan-limits-cloud.spec.ts (#222).
            PADDLE_PRICE_MONTHLY: 'pri_e2e_monthly',
            // Strict-but-surgical limit: only a deliberate 26-word journal entry
            // crosses it, so the billing lifecycle specs sharing this server
            // never trip a plan limit.
            LECTOR_PLAN_LIMITS: '{"cloud":{"journalWordsPerMonth":25}}',
          },
        },
        {
          // A FIFTH cloud-mode API for the admin dashboard spec (#221). Its own
          // fresh DATA_DIR + email outbox. LECTOR_ADMIN_EMAILS marks one fixed
          // address as the operator; the spec registers that account (admin) plus
          // an ordinary one and asserts gating, visibility, and suspension. No
          // billing armed — admin is orthogonal to subscription state.
          command:
            'rm -rf ../tmp/e2e-admin-data && mkdir -p ../tmp/e2e-admin-data && bun run src/index.ts',
          cwd: './api',
          url: `${adminApiOrigin}/health`,
          reuseExistingServer: false,
          timeout: 60_000,
          env: {
            DATA_DIR: '../tmp/e2e-admin-data',
            PORT: adminApiPort,
            LECTOR_MODE: 'cloud',
            BETTER_AUTH_SECRET: 'e2e-only-secret-2222222222222222',
            BETTER_AUTH_URL: adminApiOrigin,
            LECTOR_TRUSTED_ORIGINS: uiOrigin,
            EMAIL_FILE: '../tmp/e2e-admin-data/emails.jsonl',
            LECTOR_ADMIN_EMAILS: 'operator@e2e.test',
          },
        },
        {
          // A dedicated billing-armed API with the Free flag enabled. It proves a
          // verified no-card account reaches the full app while keeping the old
          // paid-only billing server as a flag-off regression. NODE_ENV=test skips
          // only production's Turnstile/provider boot invariant; provider calls
          // are never made by the Free browser contract spec.
          command:
            'rm -rf ../tmp/e2e-free-data && mkdir -p ../tmp/e2e-free-data && bun run src/index.ts',
          cwd: './api',
          url: `${freeApiOrigin}/health`,
          reuseExistingServer: false,
          timeout: 60_000,
          env: {
            NODE_ENV: 'test',
            DATA_DIR: '../tmp/e2e-free-data',
            PORT: freeApiPort,
            LECTOR_MODE: 'cloud',
            BETTER_AUTH_SECRET: 'e2e-only-secret-3333333333333333',
            BETTER_AUTH_URL: freeApiOrigin,
            LECTOR_TRUSTED_ORIGINS: uiOrigin,
            EMAIL_FILE: '../tmp/e2e-free-data/emails.jsonl',
            LECTOR_BILLING: 'paddle',
            LECTOR_FREE_TIER: 'true',
            PADDLE_WEBHOOK_SECRET: 'e2e-free-paddle-webhook-secret',
            PADDLE_API_KEY: 'pdl_e2e_dummy',
            BYOK_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          },
        },
      ],
});
