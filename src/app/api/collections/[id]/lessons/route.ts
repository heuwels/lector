import { proxyToApi } from '@/lib/server/api-proxy';

// GET/POST /api/collections/[id]/lessons — proxied to the Hono API (api/src/routes/collections.ts).
export const GET = proxyToApi;
export const POST = proxyToApi;
