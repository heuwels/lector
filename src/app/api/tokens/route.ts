import { proxyToApi } from '@/lib/server/api-proxy';

// GET/POST /api/tokens — proxied to the Hono API (api/src/routes/tokens.ts).
export const GET = proxyToApi;
export const POST = proxyToApi;
