import { proxyToApi } from '@/lib/server/api-proxy';

// GET/POST /api/groups — proxied to the Hono API (api/src/routes/groups.ts).
export const GET = proxyToApi;
export const POST = proxyToApi;
