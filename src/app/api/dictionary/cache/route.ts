import { proxyToApi } from '@/lib/server/api-proxy';

// POST /api/dictionary/cache — proxied to the Hono API (api/src/routes/dictionary.ts).
export const POST = proxyToApi;
