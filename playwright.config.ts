import { defineConfig, devices } from "@playwright/test";

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
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:3456",
      reuseExistingServer: !process.env.CI,
    },
    {
      // Hono API on :3457 — Next.js proxies /api/chat (and a few others) to it.
      // Started without --watch so it shuts down cleanly when Playwright exits.
      command: "bun run src/index.ts",
      cwd: "./api",
      url: "http://localhost:3457/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
