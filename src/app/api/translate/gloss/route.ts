import { proxyToApi } from '@/lib/server/api-proxy';

// POST /api/translate/gloss — proxied to the Hono API
// (api/src/routes/translate.ts). Streams a plain-text gloss; proxyToApi pipes
// the upstream body straight through, so the stream survives the hop.
export const POST = proxyToApi;
