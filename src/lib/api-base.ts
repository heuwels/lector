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

/** `fetch` against the Hono API — drop-in replacement that prepends the base URL. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init);
}
