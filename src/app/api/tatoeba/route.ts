import { proxyToApi } from '@/lib/server/api-proxy';

// GET /api/tatoeba — proxied to the Hono API (api/src/routes/tatoeba.ts).
export const GET = proxyToApi;
