import * as Sentry from "@sentry/bun";

// Sentry for the Hono API *and* the in-process classify-worker (both live in this
// Bun process). @sentry/bun is the Bun-native SDK — the API runs on `bun run`,
// not Node — and wires Bun's global uncaught-exception / unhandled-rejection
// handlers on init. Init is a no-op without SENTRY_DSN, so the SDK stays dormant
// unless a deployment opts in.
//
// Imported first thing by index.ts (and by classify-worker.ts) so init runs
// before the server starts serving or the worker's first tick fires. The DSN can
// be injected at runtime like the rest of the app's config — see
// docker-entrypoint.sh.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Distributed tracing: the browser SDK stamps sentry-trace/baggage onto its
    // cross-origin API calls; the middleware in index.ts continues those traces
    // and opens a server span per request, so a browser action and the API work
    // it triggers land in one trace. Full sampling by default (low-traffic app);
    // dial down with SENTRY_TRACES_SAMPLE_RATE on a busier deployment.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1.0") || 1.0,
    debug: process.env.SENTRY_DEBUG === "1",
    // Don't attach request bodies / user IPs by default.
    sendDefaultPii: false,
  });
}

export { Sentry };
