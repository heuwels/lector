import { proxyToApi } from '@/lib/server/api-proxy';

// POST /api/extract-url — proxied to the Hono API (api/src/routes/extract-url.ts).
export const POST = proxyToApi;
