import * as Sentry from '@sentry/bun';

// Sentry for the Hono API *and* the in-process classify-worker (both live in this
// Bun process). @sentry/bun is the Bun-native SDK — the API runs on `bun run`,
// not Node — and on init it wires Bun's global uncaught-exception /
// unhandled-rejection handlers plus auto-instrumentation of the served fetch
// handler. Init is a no-op without SENTRY_DSN, so the SDK stays dormant unless a
// deployment opts in.
//
// This module is imported FIRST by index.ts (and by classify-worker.ts) — before
// Hono and the routes — so init runs before the server's fetch handler is
// registered. That ordering is load-bearing: the auto HTTP-server instrumentation
// only patches what is set up after init. The DSN can be injected at runtime like
// the rest of the app's config — see docker-entrypoint.sh.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || undefined,
    // Distributed tracing. The auto instrumentation opens an http.server span per
    // request AND continues the inbound sentry-trace/baggage the browser SDK
    // stamps on its cross-origin calls, so a browser action and the API work it
    // triggers land in ONE trace (index.ts only relabels the span with the
    // parameterized route). Full sampling by default (low-traffic app); dial down
    // with SENTRY_TRACES_SAMPLE_RATE on a busier deployment. A deliberate 0 turns
    // tracing off; empty/unset → full. parseFloat, not Number: Number("") is 0,
    // which would silently disable tracing when compose passes an unset var as "".
    tracesSampleRate: Number.isFinite(parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? ''))
      ? parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '')
      : 1.0,
    // Drop the high-frequency, low-signal transactions the auto instrumentation
    // records for the /health probe and CORS preflights. Errors on those paths are
    // still reported — this only filters trace transactions, not events.
    beforeSendTransaction(event) {
      const name = event.transaction ?? '';
      if (name === 'GET /health' || name.startsWith('OPTIONS ')) return null;
      return event;
    },
    debug: process.env.SENTRY_DEBUG === '1',
    // Don't attach request bodies / user IPs by default.
    sendDefaultPii: false,
  });
}

export { Sentry };
