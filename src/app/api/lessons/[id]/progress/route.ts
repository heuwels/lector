import { proxyToApi } from '@/lib/server/api-proxy';

// PUT /api/lessons/[id]/progress — proxied to the Hono API (api/src/routes/lessons.ts).
export const PUT = proxyToApi;
