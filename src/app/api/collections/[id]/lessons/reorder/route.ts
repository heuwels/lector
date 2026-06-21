import { proxyToApi } from '@/lib/server/api-proxy';

// PUT /api/collections/[id]/lessons/reorder — proxied to the Hono API (api/src/routes/collections.ts).
export const PUT = proxyToApi;
