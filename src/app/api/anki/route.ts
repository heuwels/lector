import { proxyToApi } from '@/lib/server/api-proxy';

// GET/POST /api/anki — proxied to the Hono API (api/src/routes/anki.ts).
export const GET = proxyToApi;
export const POST = proxyToApi;
