import { proxyToApi } from '@/lib/server/api-proxy';

// PUT /api/collections/reorder — proxied to the Hono API (api/src/routes/collections.ts).
export const PUT = proxyToApi;
