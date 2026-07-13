import '../test-guard';
import { afterAll, describe, expect, test } from 'bun:test';
import {
  MAX_EXTRACTED_MARKDOWN_BYTES,
  extractedMarkdownFitsIngress,
  makeExtractUrlRoutes,
} from './extract-url';
import type { ExtractionBurstLimiter } from '../lib/rate-limit';

const originalFetch = globalThis.fetch;
const allowAll: ExtractionBurstLimiter = { tryConsume: () => true };

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function appWithFetch(
  fetchPage: NonNullable<Parameters<typeof makeExtractUrlRoutes>[0]['fetchPage']>,
) {
  return makeExtractUrlRoutes({
    rateLimiter: allowAll,
    enforceRateLimit: false,
    trustedProxy: 'none',
    fetchPage,
  });
}

function extract(app: ReturnType<typeof makeExtractUrlRoutes>, url = 'https://1.1.1.1/article') {
  return app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

describe('extract URL burst protection', () => {
  test('rejects before JSON parsing/fetching and keys the request by user and proxy IP', async () => {
    const seen: Array<{ userId: string; ip: string | null }> = [];
    const limiter: ExtractionBurstLimiter = {
      tryConsume(userId, ip) {
        seen.push({ userId, ip });
        return false;
      },
    };
    const app = makeExtractUrlRoutes({
      rateLimiter: limiter,
      enforceRateLimit: true,
      trustedProxy: 'cloudflare',
    });

    // Deliberately invalid JSON: a 429 proves the limiter ran before parsing or
    // any outbound fetch work.
    const response = await app.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.9',
      },
      body: '{',
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(await response.json()).toEqual({ error: 'rate_limited', retryAfterSeconds: 60 });
    expect(seen).toEqual([{ userId: 'local', ip: '203.0.113.9' }]);
  });

  test('uses only the explicitly trusted proxy header', async () => {
    const seenIps: Array<string | null> = [];
    const limiter: ExtractionBurstLimiter = {
      tryConsume(_userId, ip) {
        seenIps.push(ip);
        return false;
      },
    };
    const cloudflareApp = makeExtractUrlRoutes({
      rateLimiter: limiter,
      enforceRateLimit: true,
      trustedProxy: 'cloudflare',
    });
    await cloudflareApp.request('/', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': 'not-an-ip',
        'X-Forwarded-For': '198.51.100.4, 10.0.0.1',
      },
    });
    const untrustedApp = makeExtractUrlRoutes({
      rateLimiter: limiter,
      enforceRateLimit: true,
      trustedProxy: 'none',
    });
    await untrustedApp.request('/', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '203.0.113.9',
        'X-Forwarded-For': '198.51.100.4',
      },
    });
    expect(seenIps).toEqual([null, null]);
  });

  test('self-host mode can bypass the managed-service limiter', async () => {
    let calls = 0;
    const limiter: ExtractionBurstLimiter = {
      tryConsume() {
        calls += 1;
        return false;
      },
    };
    const app = makeExtractUrlRoutes({
      rateLimiter: limiter,
      enforceRateLimit: false,
      trustedProxy: 'none',
    });
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'URL is required', code: 'INVALID_URL' });
    expect(calls).toBe(0);
  });
});

describe('extract URL save boundary', () => {
  test('keeps returned markdown below ordinary lesson-ingress headroom', () => {
    expect(extractedMarkdownFitsIngress('x'.repeat(MAX_EXTRACTED_MARKDOWN_BYTES))).toBe(true);
    expect(extractedMarkdownFitsIngress('x'.repeat(MAX_EXTRACTED_MARKDOWN_BYTES + 1))).toBe(false);
    // Multi-byte text is measured the same way SQLite/request bodies see it.
    expect(extractedMarkdownFitsIngress('é'.repeat(MAX_EXTRACTED_MARKDOWN_BYTES / 2))).toBe(true);
    expect(extractedMarkdownFitsIngress('é'.repeat(MAX_EXTRACTED_MARKDOWN_BYTES / 2 + 1))).toBe(
      false,
    );
  });
});

describe('extract URL fetch and readability boundaries', () => {
  test('rejects a private literal before making an outbound request', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('private targets must never be fetched');
    }) as unknown as typeof fetch;
    const app = makeExtractUrlRoutes({
      rateLimiter: allowAll,
      enforceRateLimit: false,
      trustedProxy: 'none',
    });

    const response = await extract(app, 'http://127.0.0.1/private');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Please enter a valid, public URL.',
      code: 'INVALID_URL',
    });
    expect(fetchCalls).toBe(0);
  });

  test('maps upstream HTTP and timeout failures without exposing a provider exception', async () => {
    const upstream = appWithFetch(async () => new Response('down', { status: 503 }));
    const failed = await extract(upstream);
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({
      error: 'Could not fetch the page (HTTP 503)',
      code: 'FETCH_FAILED',
    });

    const timedOut = appWithFetch(async () => {
      throw new DOMException('Request timeout', 'TimeoutError');
    });
    const timeout = await extract(timedOut);
    expect(timeout.status).toBe(400);
    expect(await timeout.json()).toEqual({
      error: 'Request timed out. The page took too long to load.',
      code: 'FETCH_FAILED',
    });
  });

  test('rejects a fetched body above the cap', async () => {
    const app = appWithFetch(
      async () =>
        new Response(new Uint8Array(10 * 1024 * 1024 + 1), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    );

    const response = await extract(app);

    expect(response.status).toBe(400);
    // readBodyCapped currently shares SsrfError with unsafe-URL validation, so
    // this lands on INVALID_URL. The boundary itself is the assertion here;
    // correcting that error classification is a separate behavior fix.
    expect(await response.json()).toEqual({
      error: 'Please enter a valid, public URL.',
      code: 'INVALID_URL',
    });
  });

  test('returns NO_CONTENT for an unreadable page', async () => {
    const app = appWithFetch(
      async () =>
        new Response('<html><head><title>Empty</title></head><body></body></html>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    );

    const response = await extract(app);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'No readable content found on this page.',
      code: 'NO_CONTENT',
    });
  });

  test('extracts readable HTML with title, author, markdown, and word count', async () => {
    const app = appWithFetch(
      async () =>
        new Response(
          `<!doctype html><html><head><title>Readable test</title><meta name="author" content="By Ada"></head><body><article><h1>A useful article</h1><p>${'Readable sentence. '.repeat(40)}</p></article></body></html>`,
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        ),
    );

    const response = await extract(app);
    const body = (await response.json()) as {
      title: string;
      author: string;
      content: string;
      wordCount: number;
    };

    expect(response.status).toBe(200);
    expect(body.title).toBe('Readable test');
    expect(body.author).toBe('Ada');
    expect(body.content).toContain('Readable sentence.');
    expect(body.wordCount).toBeGreaterThan(40);
  });
});
