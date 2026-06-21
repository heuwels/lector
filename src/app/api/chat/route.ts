import { proxyToApi } from '@/lib/server/api-proxy';

// The Hono API owns chat history + LLM; this is a thin proxy. force-dynamic so
// the GET history is never statically cached.
export const dynamic = 'force-dynamic';

// GET/POST/DELETE /api/chat — proxied to the Hono API (api/src/routes/chat.ts).
export const GET = proxyToApi;
export const POST = proxyToApi;
export const DELETE = proxyToApi;
