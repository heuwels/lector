import { proxyToApi } from '@/lib/server/api-proxy';

// PUT/DELETE /api/groups/[id] — proxied to the Hono API (api/src/routes/groups.ts).
export const PUT = proxyToApi;
export const DELETE = proxyToApi;
