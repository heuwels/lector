import { NextRequest } from 'next/server';

/**
 * The Hono API (Bun) is the single source of truth for backend logic. Every
 * Next.js `/api/*` route is a thin proxy that forwards to it; this helper does
 * the forwarding — same method, path, query string, body and headers, with the
 * upstream response streamed straight back.
 *
 * Point it at the backend with INTERNAL_API_URL (defaults to the local Hono dev
 * port). This generalises the hand-written proxies already used for the LLM
 * routes (translate, explain, chat, …) so CRUD routes don't each re-implement
 * the fetch dance.
 */
const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:3457';

// Per-hop / length headers that must not be copied verbatim across the proxy.
const STRIP_REQUEST_HEADERS = ['host', 'connection', 'content-length'];
const STRIP_RESPONSE_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
];

export async function proxyToApi(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const target = `${API_URL}${url.pathname}${url.search}`;

  const headers = new Headers(request.headers);
  for (const h of STRIP_REQUEST_HEADERS) headers.delete(h);

  const init: RequestInit = {
    method: request.method,
    headers,
  };

  // GET/HEAD carry no body; everything else is forwarded byte-for-byte so JSON,
  // multipart uploads (epub import) and the like survive the hop intact.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  const upstream = await fetch(target, init);

  const responseHeaders = new Headers(upstream.headers);
  for (const h of STRIP_RESPONSE_HEADERS) responseHeaders.delete(h);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
