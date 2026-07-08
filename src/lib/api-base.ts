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

declare global {
  interface Window {
    __ENV__?: { API_URL?: string; LECTOR_MODE?: string };
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
  const raw =
    typeof window === 'undefined' ? process.env.LECTOR_MODE : window.__ENV__?.LECTOR_MODE;
  return raw === 'cloud' ? 'cloud' : 'selfhost';
}

export function apiBase(): string {
  const configured =
    typeof window === 'undefined' ? process.env.API_URL : window.__ENV__?.API_URL;
  return (configured || DEFAULT_API_URL).replace(/\/+$/, '');
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
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    // Cloud sessions are cookies (#218/#220). Same-origin (the prod path-split
    // deploy) sends them regardless; cross-origin (dev: UI :3456 → API :3467)
    // only sends them with explicit credentials, paired with the API's
    // pinned-origin CORS. Selfhost keeps fetch defaults — its wide-open CORS
    // is credential-less by design.
    const credentials = init?.credentials ?? (lectorMode() === 'cloud' ? 'include' : undefined);
    return await fetch(apiUrl(path), { ...init, credentials });
  } catch {
    return new Response(
      JSON.stringify({ error: 'The API is currently unavailable. Please try again in a moment.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
