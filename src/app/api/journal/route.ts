import { proxyToApi } from '@/lib/server/api-proxy';

// GET/POST /api/journal — proxied to the Hono API (api/src/routes/journal.ts).
export const GET = proxyToApi;
export const POST = proxyToApi;
