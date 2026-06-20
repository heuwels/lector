import { proxyToApi } from '@/lib/server/api-proxy';

// GET/POST /api/study-ping — proxied to the Hono API (api/src/routes/study-ping.ts).
export const GET = proxyToApi;
export const POST = proxyToApi;
