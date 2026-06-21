import { proxyToApi } from '@/lib/server/api-proxy';

// DELETE /api/tokens/[id] — proxied to the Hono API (api/src/routes/tokens.ts).
export const DELETE = proxyToApi;
