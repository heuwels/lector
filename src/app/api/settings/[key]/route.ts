import { proxyToApi } from '@/lib/server/api-proxy';

// GET/PUT/DELETE /api/settings/[key] — proxied to the Hono API (api/src/routes/settings.ts).
export const GET = proxyToApi;
export const PUT = proxyToApi;
export const DELETE = proxyToApi;
