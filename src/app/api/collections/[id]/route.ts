import { proxyToApi } from '@/lib/server/api-proxy';

// GET/PUT/DELETE /api/collections/[id] — proxied to the Hono API (api/src/routes/collections.ts).
export const GET = proxyToApi;
export const PUT = proxyToApi;
export const DELETE = proxyToApi;
