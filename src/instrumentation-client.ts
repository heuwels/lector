import * as Sentry from '@sentry/nextjs';

// Front-end (browser) Sentry. Next.js runs this module on the client during early
// bootstrap — notably BEFORE the runtime config script executes.
//
// The DSN + API origin are runtime config, read from `window.__ENV__` (injected
// by /__env.js — see docker-entrypoint.sh and src/lib/api-base.ts), with a
// build-time NEXT_PUBLIC_SENTRY_DSN fallback for anyone who prefers to bake it.
// Runtime injection is deliberate: most routes are statically prerendered, so
// the values can't be server-rendered into the HTML — they'd bake empty at build
// (this is the same reason API_URL uses __env.js). The trade-off is timing:
// Next executes /__env.js (a `beforeInteractive` script) via its own script
// queue AFTER this module evaluates, so reading window.__ENV__ here at eval time
// finds it undefined. Hence we DEFER init until the config lands — see below.

let initialized = false;

function initSentry(): boolean {
  if (initialized) return true;
  const env = typeof window !== 'undefined' ? window.__ENV__ : undefined;
  const dsn = env?.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return false;
  initialized = true;

  const apiUrl = env?.API_URL || 'http://localhost:3457';
  Sentry.init({
    dsn,
    environment: env?.SENTRY_ENVIRONMENT || undefined,
    integrations: [Sentry.browserTracingIntegration()],
    // Full tracing on a low-traffic app. browserTracing samples page loads +
    // navigations and — the load-bearing part for end-to-end traces —
    // propagates sentry-trace/baggage onto the cross-origin apiFetch() calls.
    // Finite rate from env (a deliberate 0 turns tracing OFF); empty/unset → full.
    // parseFloat, not Number: Number("") is 0, which would silently disable tracing.
    tracesSampleRate: Number.isFinite(
      parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? ''),
    )
      ? parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '')
      : 1.0,
    // Attach trace headers to the Hono API (a different origin — see
    // api-base.ts) and to any same-origin /api call, and nowhere else. Without
    // this the browser strips the headers and the trace dead-ends here instead
    // of joining the API + worker spans. "localhost" covers cross-origin dev
    // (UI :3466 → API :3468) regardless of the resolved apiUrl.
    tracePropagationTargets: ['localhost', apiUrl, /^\/api\//],
    debug: process.env.NEXT_PUBLIC_SENTRY_DEBUG === '1',
    sendDefaultPii: false,
  });
  return true;
}

if (typeof window !== 'undefined' && !initSentry()) {
  // window.__ENV__ isn't populated yet. Poll until the runtime script defines it
  // (whether or not it carries a DSN), then init once. Stops the instant the
  // script runs — a few frames at most; the app's traced API calls fire after
  // React mounts, long after this resolves, so no early spans are lost. The cap
  // bounds the no-op case where /__env.js never loads (misconfiguration) and,
  // for a Sentry-less deployment, we stop as soon as __ENV__ is defined without
  // a DSN — no idle polling.
  let tries = 0;
  const timer = setInterval(() => {
    const ready = typeof window.__ENV__ !== 'undefined';
    if (ready || ++tries > 150 /* ~3s */) {
      clearInterval(timer);
      if (ready) initSentry();
    }
  }, 20);
}

// App Router navigation instrumentation — required export so @sentry/nextjs can
// fold route changes into the trace. Safe to export even before init runs.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
