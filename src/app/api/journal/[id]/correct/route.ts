import { proxyToApi } from '@/lib/server/api-proxy';

// POST /api/journal/[id]/correct — proxied to the Hono API; the read→correct→save
// flow now lives in api/src/routes/journal.ts (POST /:id/correct).
export const POST = proxyToApi;
