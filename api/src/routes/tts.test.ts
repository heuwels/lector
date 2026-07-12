import '../test-guard';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db } from '../db';
import { resetTtsCache } from '../lib/tts-cache';
import app from './tts';

const originalFetch = globalThis.fetch;
const previousApiKey = process.env.GOOGLE_CLOUD_API_KEY;
const previousTtsCache = process.env.TTS_CACHE;

function ttsUsage(): number | null {
  const row = db
    .prepare(
      "SELECT value FROM usage_counters WHERE userId = 'local' AND metric = 'ttsCharsPerMonth'",
    )
    .get() as { value: number } | undefined;
  return row?.value ?? null;
}

beforeEach(() => {
  process.env.GOOGLE_CLOUD_API_KEY = 'google-test-key';
  db.prepare(
    "DELETE FROM usage_counters WHERE userId = 'local' AND metric = 'ttsCharsPerMonth'",
  ).run();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (previousApiKey === undefined) delete process.env.GOOGLE_CLOUD_API_KEY;
  else process.env.GOOGLE_CLOUD_API_KEY = previousApiKey;
  if (previousTtsCache === undefined) delete process.env.TTS_CACHE;
  else process.env.TTS_CACHE = previousTtsCache;
  resetTtsCache();
});

describe('TTS route request boundaries', () => {
  test('returns 413 before provider fetch or usage reservation for an oversized body', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new Error('oversized TTS bodies must not reach Google');
    }) as unknown as typeof fetch;

    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello', padding: 'x'.repeat(33 * 1024) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: 'TTS request is too large',
      fallback: true,
    });
    expect(fetchCalls).toBe(0);
    expect(ttsUsage()).toBeNull();
  });

  test("rejects text beyond Google's 5,000-byte content limit before fetch or metering", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new Error('over-limit TTS text must not reach Google');
    }) as unknown as typeof fetch;

    // 2,501 two-byte UTF-8 characters = 5,002 bytes despite only 2,501 JS chars.
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'é'.repeat(2_501) }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Text is too long (max 5,000 bytes)',
      fallback: true,
    });
    expect(fetchCalls).toBe(0);
    expect(ttsUsage()).toBeNull();
  });

  test('accepts exactly 5,000 UTF-8 bytes and preserves character metering', async () => {
    const captured: { request: Request | null } = { request: null };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.request = new Request(input, init);
      return Response.json({ audioContent: 'encoded-audio' });
    }) as unknown as typeof fetch;

    const text = 'é'.repeat(2_500);
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      audioContent: 'encoded-audio',
      contentType: 'audio/mp3',
    });
    expect(captured.request?.url).toContain(
      'https://texttospeech.googleapis.com/v1/text:synthesize?key=google-test-key',
    );
    expect(JSON.parse((await captured.request?.text()) ?? '{}').input.text).toBe(text);
    expect(ttsUsage()).toBe(2_500);
  });
});

describe('TTS caching (#226)', () => {
  const synthesize = (text: string) =>
    app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

  test('replays of the same tuple are served from cache: one Google call, metered once', async () => {
    delete process.env.TTS_CACHE;
    resetTtsCache();
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      return Response.json({ audioContent: 'Y2FjaGVkLWF1ZGlv' }); // "cached-audio"
    }) as unknown as typeof fetch;

    const first = await synthesize('kandelaar');
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      audioContent: 'Y2FjaGVkLWF1ZGlv',
      contentType: 'audio/mp3',
    });
    expect(fetchCalls).toBe(1);
    expect(ttsUsage()).toBe('kandelaar'.length);

    // The replay must not need the Google key at all — drop it to prove the
    // request never leaves the cache.
    delete process.env.GOOGLE_CLOUD_API_KEY;
    const second = await synthesize('kandelaar');
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      audioContent: 'Y2FjaGVkLWF1ZGlv',
      contentType: 'audio/mp3',
      cached: true,
    });
    expect(fetchCalls).toBe(1);
    expect(ttsUsage()).toBe('kandelaar'.length);
  });

  test('failed synthesis is not cached and the retry re-fetches', async () => {
    delete process.env.TTS_CACHE;
    resetTtsCache();
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      if (fetchCalls === 1) {
        return Response.json({ error: { message: 'boom' } }, { status: 500 });
      }
      return Response.json({ audioContent: 'aGVyc3RlbA==' });
    }) as unknown as typeof fetch;

    const failed = await synthesize('herstelbaar');
    expect(failed.status).toBe(500);
    expect(ttsUsage()).toBe(0); // reserved, then refunded

    const retried = await synthesize('herstelbaar');
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({
      audioContent: 'aGVyc3RlbA==',
      contentType: 'audio/mp3',
    });
    expect(fetchCalls).toBe(2);
  });

  test('TTS_CACHE=0 keeps every request on the synthesis path', async () => {
    process.env.TTS_CACHE = '0';
    resetTtsCache();
    try {
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls++;
        return Response.json({ audioContent: 'b25nZWNhY2hl' });
      }) as unknown as typeof fetch;

      expect((await synthesize('ongecached')).status).toBe(200);
      expect((await synthesize('ongecached')).status).toBe(200);
      expect(fetchCalls).toBe(2);
      expect(ttsUsage()).toBe('ongecached'.length * 2);
    } finally {
      delete process.env.TTS_CACHE;
      resetTtsCache();
    }
  });
});
