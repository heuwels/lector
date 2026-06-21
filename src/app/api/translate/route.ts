import { proxyToApi } from '@/lib/server/api-proxy';

// POST /api/translate — proxied to the Hono API (api/src/routes/translate.ts).
// Hono's translate route records the study ping itself, so this is a pure proxy.
export const POST = proxyToApi;
