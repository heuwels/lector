import { proxyToApi } from '@/lib/server/api-proxy';

// GET/POST /api/known-words — proxied to the Hono API (api/src/routes/known-words.ts).
export const GET = proxyToApi;
export const POST = proxyToApi;
