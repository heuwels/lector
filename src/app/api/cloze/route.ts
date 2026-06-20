import { proxyToApi } from '@/lib/server/api-proxy';

// GET/POST /api/cloze — proxied to the Hono API (api/src/routes/cloze.ts).
export const GET = proxyToApi;
export const POST = proxyToApi;
