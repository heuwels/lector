import '../test-guard';
import { describe, expect, test } from 'bun:test';
import {
  MAX_EXTRACTED_MARKDOWN_BYTES,
  extractedMarkdownFitsIngress,
  makeExtractUrlRoutes,
} from './extract-url';
import type { ExtractionBurstLimiter } from '../lib/rate-limit';

describe('extract URL burst protection', () => {
  test('rejects before JSON parsing/fetching and keys the request by user and proxy IP', async () => {
    const seen: Array<{ userId: string; ip: string | null }> = [];
    const limiter: ExtractionBurstLimiter = {
      tryConsume(userId, ip) {
        seen.push({ userId, ip });
        return false;
      },
    };
    const app = makeExtractUrlRoutes({ rateLimiter: limiter, enforceRateLimit: true });

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

  test('uses the first valid forwarded IP and ignores malformed proxy values', async () => {
    const seenIps: Array<string | null> = [];
    const limiter: ExtractionBurstLimiter = {
      tryConsume(_userId, ip) {
        seenIps.push(ip);
        return false;
      },
    };
    const app = makeExtractUrlRoutes({ rateLimiter: limiter, enforceRateLimit: true });
    await app.request('/', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': 'not-an-ip',
        'X-Forwarded-For': '198.51.100.4, 10.0.0.1',
      },
    });
    expect(seenIps).toEqual(['198.51.100.4']);
  });

  test('self-host mode can bypass the managed-service limiter', async () => {
    let calls = 0;
    const limiter: ExtractionBurstLimiter = {
      tryConsume() {
        calls += 1;
        return false;
      },
    };
    const app = makeExtractUrlRoutes({ rateLimiter: limiter, enforceRateLimit: false });
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
