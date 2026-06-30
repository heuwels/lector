/**
 * Resolves the base URL of the Hono API and wraps `fetch` for it.
 *
 * The browser talks to the Hono API directly — the old Next.js `/api/*` proxy
 * routes are gone (#188). The API listens on its own port (3457 by default), so
 * its origin is the same host the UI was served from, on the API port. Deriving
 * that from `window.location` at *runtime* means one prebuilt image works
 * whether the app is reached over localhost, a Tailnet IP, or a hostname — no
 * rebuild per host.
 *
 * Overrides, in priority order:
 *   NEXT_PUBLIC_API_URL   full origin (e.g. https://lector.example.com) for
 *                         reverse-proxied / custom-origin setups. Wins outright.
 *   NEXT_PUBLIC_API_PORT  just the port (default 3457), for a non-default
 *                         published API port.
 *
 * Off the browser (SSR, `next build`, unit tests — no `window`) there is no
 * location to derive from, so fall back to INTERNAL_API_URL (the in-container
 * address), matching the old proxy's default.
 */

const DEFAULT_API_PORT = '3457';

export function apiBase(): string {
  const override = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (override) return override.replace(/\/+$/, '');

  if (typeof window === 'undefined') {
    const internal =
      process.env.INTERNAL_API_URL?.trim() || `http://localhost:${DEFAULT_API_PORT}`;
    return internal.replace(/\/+$/, '');
  }

  const port = process.env.NEXT_PUBLIC_API_PORT?.trim() || DEFAULT_API_PORT;
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
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
    return await fetch(apiUrl(path), init);
  } catch {
    return new Response(
      JSON.stringify({ error: 'The API is currently unavailable. Please try again in a moment.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
