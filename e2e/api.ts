// Base URL of the Hono API that the e2e specs talk to directly — the Next.js
// `/api` proxy was removed (#188), so `page.request` calls and global-setup hit
// Hono on its own origin. Override with E2E_API_URL to point at a different
// host/port (e.g. a remote box, or an external server mapped to a non-default
// port); defaults to the port the Playwright webServer + docker-compose expose.
export const API_BASE = (process.env.E2E_API_URL ?? 'http://localhost:3457').replace(/\/+$/, '');

/** Absolute URL for a Hono API path, e.g. `apiUrl('/api/vocab')`. */
export const apiUrl = (path: string): string => `${API_BASE}${path}`;
