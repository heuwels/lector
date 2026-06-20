import { proxyToApi } from '@/lib/server/api-proxy';

// POST /api/anki/sync-reviews — proxied to the Hono API (api/src/routes/anki.ts).
export const POST = proxyToApi;
