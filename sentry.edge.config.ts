import * as Sentry from '@sentry/nextjs';

// Next.js edge runtime (middleware / edge routes). The app has none today, but
// keep it initialized so any future edge code reports. No-op until a DSN is set.
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
    debug: process.env.SENTRY_DEBUG === '1',
    sendDefaultPii: false,
  });
}
