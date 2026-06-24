import { proxyToApi } from '@/lib/server/api-proxy';

// POST /api/cloze/[id]/review — proxied to the Hono API (api/src/routes/cloze.ts).
export const POST = proxyToApi;
