import * as Sentry from '@sentry/nextjs';

// Next.js server runtime (SSR / RSC). The app is client-fetch heavy so this
// rarely calls the Hono API server-side, but instrument it for SSR/server-action
// errors and parity with the browser + API tiers. No-op until a DSN is set.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || undefined,
    // Finite rate from env (a deliberate 0 turns tracing OFF); empty/unset → full.
    // parseFloat, not Number: Number("") is 0, which would silently disable
    // tracing when compose passes an unset var through as "".
    tracesSampleRate: Number.isFinite(parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? ''))
      ? parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '')
      : 1.0,
    tracePropagationTargets: [
      'localhost',
      process.env.API_URL || 'http://localhost:3457',
      /^\/api\//,
    ],
    debug: process.env.SENTRY_DEBUG === '1',
    sendDefaultPii: false,
  });
}
