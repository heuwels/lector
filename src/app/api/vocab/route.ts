import { proxyToApi } from '@/lib/server/api-proxy';

// GET/POST /api/vocab — proxied to the Hono API (api/src/routes/vocab.ts).
export const GET = proxyToApi;
export const POST = proxyToApi;
