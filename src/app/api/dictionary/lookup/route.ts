import { proxyToApi } from '@/lib/server/api-proxy';

// GET /api/dictionary/lookup — proxied to the Hono API (api/src/routes/dictionary.ts).
export const GET = proxyToApi;
