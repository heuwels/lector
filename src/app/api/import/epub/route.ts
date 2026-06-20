import { proxyToApi } from '@/lib/server/api-proxy';

// POST /api/import/epub — proxied to the Hono API (api/src/routes/import.ts).
export const POST = proxyToApi;
