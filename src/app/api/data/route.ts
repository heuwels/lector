import { proxyToApi } from '@/lib/server/api-proxy';

// GET/POST /api/data — proxied to the Hono API (api/src/routes/data.ts).
export const GET = proxyToApi;
export const POST = proxyToApi;
