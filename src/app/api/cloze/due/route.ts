import { proxyToApi } from '@/lib/server/api-proxy';

// GET /api/cloze/due — proxied to the Hono API (api/src/routes/cloze.ts).
export const GET = proxyToApi;
