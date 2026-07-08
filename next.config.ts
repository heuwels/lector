import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { execSync } from "node:child_process";

// ── Build / version metadata (shown in Settings → About) ─────────────────────
// In Docker/CI the build context has no `.git` (excluded via .dockerignore), so
// the git-derived values are passed in as build args — see the Dockerfile and
// the `docker.yml` / `release.yml` workflows — and read here from process.env.
// Local `next dev` / `next build` has `.git`, so we fall back to running git
// directly. BUILD_TIME has no git dependency: the `new Date()` fallback runs
// during the build (including inside the Docker builder), so it is correct
// everywhere and is never passed as a build arg.
function git(command: string): string {
  try {
    return execSync(command, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const appVersion =
  process.env.APP_VERSION?.trim() ||
  git("git describe --tags --always --dirty") ||
  "unknown";
const gitCommit =
  process.env.GIT_COMMIT?.trim() || git("git rev-parse HEAD") || "unknown";
const gitBranch =
  process.env.GIT_BRANCH?.trim() ||
  git("git rev-parse --abbrev-ref HEAD") ||
  "unknown";
const buildTime = process.env.BUILD_TIME?.trim() || new Date().toISOString();

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  // Turbopack is the default in Next.js 16. Empty config silences the
  // "webpack config but no turbopack config" warning.
  // Turbopack respects .gitignore so data/ (SQLite WAL files) is already ignored.
  turbopack: {},
  // Inlined into the bundle (client + server) so the About panel can render the
  // build it was compiled from. Computed once above; never changes at runtime.
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_GIT_COMMIT: gitCommit,
    NEXT_PUBLIC_GIT_BRANCH: gitBranch,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
};

export default withSentryConfig(nextConfig, {
  // Source-map upload gives un-minified production front-end stack traces (the
  // "full stack traces" this instrumentation is for). It runs during
  // `next build` only, and only when a Sentry auth token is present — a clean
  // no-op for local dev / CI without one. To enable, set SENTRY_AUTH_TOKEN
  // (sentry.io → Settings → Auth Tokens, project:releases scope) plus the
  // SENTRY_ORG / SENTRY_PROJECT slugs.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // Upload a wider set of client bundles for prettier stack traces.
  widenClientFileUpload: true,
  // Disable telemetry
  telemetry: false,
});
