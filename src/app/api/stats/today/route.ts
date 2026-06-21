import { proxyToApi } from '@/lib/server/api-proxy';

// GET/PUT /api/stats/today — proxied to the Hono API (api/src/routes/stats.ts).
export const GET = proxyToApi;
export const PUT = proxyToApi;
