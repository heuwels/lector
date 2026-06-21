import { proxyToApi } from '@/lib/server/api-proxy';

// POST /api/tts — proxied to the Hono API (api/src/routes/tts.ts).
export const POST = proxyToApi;
