import { proxyToApi } from '@/lib/server/api-proxy';

// POST /api/translate/enrich — proxied to the Hono API
// (api/src/routes/translate.ts). Returns the rich structured word entry.
export const POST = proxyToApi;
