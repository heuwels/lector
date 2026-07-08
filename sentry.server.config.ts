import * as Sentry from "@sentry/nextjs";

// Next.js server runtime (SSR / RSC). The app is client-fetch heavy so this
// rarely calls the Hono API server-side, but instrument it for SSR/server-action
// errors and parity with the browser + API tiers. No-op until a DSN is set.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Finite rate from env (a deliberate 0 turns tracing OFF); else full.
    // `Number(x) || 1.0` would wrongly coerce 0 back to 1.0.
    tracesSampleRate: Number.isFinite(Number(process.env.SENTRY_TRACES_SAMPLE_RATE))
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 1.0,
    tracePropagationTargets: [
      "localhost",
      process.env.API_URL || "http://localhost:3457",
      /^\/api\//,
    ],
    debug: process.env.SENTRY_DEBUG === "1",
    sendDefaultPii: false,
  });
}
