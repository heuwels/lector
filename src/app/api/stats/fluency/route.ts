import { proxyToApi } from '@/lib/server/api-proxy';

// GET /api/stats/fluency — proxied to the Hono API (api/src/routes/stats.ts).
export const GET = proxyToApi;
