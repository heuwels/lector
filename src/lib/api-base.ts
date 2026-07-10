/**
 * Resolves the base URL of the Hono API and wraps `fetch` for it.
 *
 * The browser talks to the Hono API directly — the Next.js `/api/*` proxy was
 * removed (#188). The API origin is configured at *runtime*, not baked at build:
 *
 *   - In the browser it's read from `window.__ENV__.API_URL`, injected by a tiny
 *     `/__env.js` that `docker-entrypoint.sh` writes from the `API_URL` env var
 *     when the container starts. (NEXT_PUBLIC_* can't carry this: it's inlined at
 *     build time, so it can't be set per-deployment on a prebuilt image.)
 *   - On the server (SSR / build / tests — no `window`) it's read from
 *     `process.env.API_URL`.
 *
 * Both fall back to http://localhost:3457 (the dev / docker-compose default) so
 * local `next dev` and the e2e suite need no configuration. A remote deployment
 * MUST set `API_URL` to the origin the browser uses to reach the API
 * (e.g. http://lector.my-tailnet.ts.net:3457), or browser calls fall back to the
 * user's own localhost and fail.
 */

import { interceptPlanLimit } from './plan-limits';

declare global {
  interface Window {
    __ENV__?: {
      API_URL?: string;
      /** Sentry DSN for the browser SDK (public by design — the DSN is meant to
       *  ship in client code). Injected at runtime like API_URL so a prebuilt
       *  image can be pointed at a project without a rebuild; read by
       *  src/instrumentation-client.ts. */
      SENTRY_DSN?: string;
      /** Deployment label shared by browser/API/server Sentry events. */
      SENTRY_ENVIRONMENT?: string;
      LECTOR_MODE?: string;
      /** Where a locked cloud account is sent to check out (#224): the
       *  marketing site's approved-domain checkout page, e.g.
       *  https://lector.dev/checkout. app.lector.dev is not a Paddle-approved
       *  checkout domain, so the overlay can't open in-app. */
      CHECKOUT_URL?: string;
      /** Cloudflare Turnstile site key — presence turns the widget on (#218). */
      TURNSTILE_SITE_KEY?: string;
      /** '1' when the API has GitHub OAuth configured — shows the button (#218). */
      GITHUB_LOGIN?: string;
      /** '1' when the API has a BYO OIDC provider configured (#218). */
      OIDC_LOGIN?: string;
      /** Label for the OIDC sign-in button (e.g. "Authentik"); default "SSO". */
      OIDC_PROVIDER_NAME?: string;
    };
  }
}

const DEFAULT_API_URL = 'http://localhost:3457';

export type LectorMode = 'selfhost' | 'cloud';

/**
 * Deployment mode (#242): 'selfhost' (the default, today's app) or 'cloud'
 * (the future managed offering). Injected the same way as API_URL —
 * `/__env.js` in a container, `process.env` on the server. Deliberately
 * fail-safe toward 'selfhost': anything unset or unrecognized reads as
 * selfhost so the client can never render cloud-only chrome by accident
 * (strict validation lives server-side in api/src/lib/config.ts).
 */
export function lectorMode(): LectorMode {
  const raw = typeof window === 'undefined' ? process.env.LECTOR_MODE : window.__ENV__?.LECTOR_MODE;
  return raw === 'cloud' ? 'cloud' : 'selfhost';
}

export function apiBase(): string {
  const configured = typeof window === 'undefined' ? process.env.API_URL : window.__ENV__?.API_URL;
  return (configured || DEFAULT_API_URL).replace(/\/+$/, '');
}

/**
 * The marketing-site checkout URL (#224), read at runtime like API_URL. Empty
 * when unset — the /subscribe screen treats that as "checkout unavailable"
 * (dev and the e2e billing server run without it). Trailing slash trimmed so
 * `${checkoutUrl()}?_ptxn=…` is well-formed.
 */
export function checkoutUrl(): string {
  const configured =
    typeof window === 'undefined' ? process.env.CHECKOUT_URL : window.__ENV__?.CHECKOUT_URL;
  return (configured || '').replace(/\/+$/, '');
}

/** Routes that must render without a session (and without app chrome). #218
 * /two-factor is mid-sign-in: the password step set a challenge cookie but
 * the session only exists once the code verifies. */
export const AUTH_ROUTES = ['/login', '/register', '/reset-password', '/two-factor'] as const;

export function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/** Where a cloud account without an active subscription lands (#224). */
export const BILLING_ROUTE = '/subscribe';

/**
 * Chrome-free routes: the pre-session auth pages plus /subscribe. NavHeader,
 * SetupGuard, and ChatWidget key off this (a locked account must see nothing
 * app-shaped); AuthGuard deliberately keeps isAuthRoute — /subscribe still
 * requires a session.
 */
export function isBareRoute(pathname: string): boolean {
  return isAuthRoute(pathname) || pathname === BILLING_ROUTE;
}

let bouncedToLogin = false;

/**
 * Idempotent hard redirect to /login (#218). Both the 401 handler below and
 * AuthGuard funnel through this ONE mechanism: mixing a hard
 * `location.assign` with a concurrent soft `router.replace` aborts whichever
 * navigation loses the race (net::ERR_ABORTED), and several components can
 * observe "no session" in the same tick. First caller wins; the rest no-op.
 * Hard (not soft) so every in-memory state and cache resets with the session.
 */
export function bounceToLogin(): void {
  if (bouncedToLogin || typeof window === 'undefined') return;
  if (isAuthRoute(window.location.pathname)) return;
  bouncedToLogin = true;
  window.location.replace('/login');
}

let bouncedToSubscribe = false;

/**
 * bounceToLogin's billing twin (#224): the idempotent hard redirect for
 * 402 `subscription_required`. BillingGuard and the apiFetch handler below
 * both funnel through it; already being on /subscribe no-ops (that page's
 * own status fetch is billing-exempt, so it can never loop).
 */
export function bounceToSubscribe(): void {
  if (bouncedToSubscribe || typeof window === 'undefined') return;
  if (window.location.pathname === BILLING_ROUTE || isAuthRoute(window.location.pathname)) return;
  bouncedToSubscribe = true;
  window.location.replace(BILLING_ROUTE);
}

/** Absolute URL for an API path (e.g. `apiUrl('/api/vocab')`). */
export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${apiBase()}${suffix}`;
}

/**
 * `fetch` against the Hono API — prepends the base URL.
 *
 * If the API is unreachable (down, restarting, connection refused, or a CORS
 * failure), `fetch` rejects. The old Next.js proxy instead returned a parseable
 * JSON 502, so callers doing `(await apiFetch(...)).json()` never threw. We keep
 * that contract here — catch the rejection and return the same synthetic 502 —
 * so removing the proxy doesn't turn a transient API outage into unhandled
 * promise rejections across the (largely try/catch-free) data layer.
 *
 * Cloud mode (#218): session cookies must ride every call, so credentials are
 * included — but ONLY in cloud. Selfhost CORS answers `*`, which the browser
 * rejects for credentialed requests; forcing `include` there would break every
 * cross-origin selfhost deployment. A 401 in cloud means no/expired session:
 * bounce to /login (hard navigation, so all in-flight state resets).
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const cloud = lectorMode() === 'cloud';
  try {
    // Cloud sessions are cookies (#218/#220). Same-origin (the prod path-split
    // deploy) sends them regardless; cross-origin (dev: UI :3456 → API :3467)
    // only sends them with explicit credentials, paired with the API's
    // pinned-origin CORS. Selfhost keeps fetch defaults — its wide-open CORS
    // is credential-less by design.
    const credentials = init?.credentials ?? (cloud ? 'include' : undefined);
    const res = await fetch(apiUrl(path), { ...init, credentials });
    if (cloud && res.status === 401) {
      bounceToLogin();
    }
    // 402 = authenticated but not subscribed (#224) — the billing gate's
    // signal. Same hard-navigation reasoning as the 401 bounce.
    if (cloud && res.status === 402) {
      bounceToSubscribe();
    }
    // 429 plan_limit (#222) = subscribed but over a plan allowance — a soft
    // upsell prompt, never a redirect. Centralized here so every surface
    // (reader, journal, practice, imports) gets the graceful UX for free;
    // the response still flows to the caller.
    if (res.status === 429) {
      interceptPlanLimit(res);
    }
    return res;
  } catch {
    return new Response(
      JSON.stringify({ error: 'The API is currently unavailable. Please try again in a moment.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
