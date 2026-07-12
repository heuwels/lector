import '../test-guard';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { getTtsCache, resetTtsCache, ttsCacheKey } from './tts-cache';

const ENV_KEYS = ['TTS_CACHE', 'TTS_CACHE_S3_BUCKET', 'TTS_CACHE_MAX_BYTES'] as const;
let saved: Record<string, string | undefined> = {};

// The test runner isolates DATA_DIR=.test-data, so the disk backend lands there.
const cacheRoot = path.join(process.env.DATA_DIR || '../data', 'tts-cache');

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resetTtsCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetTtsCache();
});

afterAll(() => {
  fs.rmSync(cacheRoot, { recursive: true, force: true });
});

describe('ttsCacheKey', () => {
  const base = { language: 'af', voice: 'af-ZA:af-ZA-Standard-A', rate: 0.9, text: 'hallo wêreld' };

  test('is deterministic for identical tuples', () => {
    expect(ttsCacheKey({ ...base })).toEqual(ttsCacheKey({ ...base }));
  });

  test('every tuple component changes the key', () => {
    const variants = [
      { ...base, text: 'hallo wereld' },
      { ...base, voice: 'af-ZA:af-ZA-Standard-B' },
      { ...base, rate: 1.0 },
      { ...base, language: 'nl' },
    ];
    const hashes = new Set([ttsCacheKey(base).hash, ...variants.map((v) => ttsCacheKey(v).hash)]);
    expect(hashes.size).toBe(variants.length + 1);
  });

  test('object key is language-sharded and hash-named', () => {
    const key = ttsCacheKey(base);
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(key.objectKey).toBe(`af/${key.hash.slice(0, 2)}/${key.hash}.mp3`);
  });
});

describe('backend selection', () => {
  test('defaults to the disk backend', () => {
    expect(getTtsCache().backend).toBe('disk');
  });

  test('TTS_CACHE=0 disables caching entirely', async () => {
    process.env.TTS_CACHE = '0';
    resetTtsCache();
    const cache = getTtsCache();
    expect(cache.backend).toBe('off');
    const key = ttsCacheKey({ language: 'af', voice: 'v', rate: 1, text: 'off-test' });
    await cache.put(key, new Uint8Array([1, 2, 3]));
    expect(await cache.get(key)).toBeNull();
  });

  test('TTS_CACHE_S3_BUCKET selects the S3 backend', () => {
    process.env.TTS_CACHE_S3_BUCKET = 'lector-tts-cache-test';
    resetTtsCache();
    expect(getTtsCache().backend).toBe('s3');
  });
});

describe('disk backend', () => {
  test('round-trips bytes and misses cleanly', async () => {
    const cache = getTtsCache();
    const key = ttsCacheKey({ language: 'af', voice: 'v', rate: 0.9, text: 'roundtrip' });
    expect(await cache.get(key)).toBeNull();

    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]); // ID3v2 header-ish
    await cache.put(key, bytes);
    expect(await cache.get(key)).toEqual(bytes);
    expect(fs.existsSync(path.join(cacheRoot, key.objectKey))).toBe(true);
  });

  test('evicts least-recently-used entries once over the byte cap', async () => {
    process.env.TTS_CACHE_MAX_BYTES = '100';
    resetTtsCache();
    const cache = getTtsCache();

    const keyFor = (text: string) => ttsCacheKey({ language: 'af', voice: 'v', rate: 1, text });
    const chunk = () => new Uint8Array(40).fill(7);

    const oldest = keyFor('evict-oldest');
    const middle = keyFor('evict-middle');
    await cache.put(oldest, chunk());
    await cache.put(middle, chunk());
    // Age the first two entries so LRU order is unambiguous regardless of
    // filesystem mtime granularity.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(cacheRoot, oldest.objectKey), past, past);
    fs.utimesSync(
      path.join(cacheRoot, middle.objectKey),
      new Date(past.getTime() + 1000),
      new Date(past.getTime() + 1000),
    );

    // 120 bytes total > 100-byte cap; the sweep (threshold = cap/4 = 25 bytes,
    // so every put sweeps) must drop to ≤90 bytes by evicting the oldest.
    const newest = keyFor('evict-newest');
    await cache.put(newest, chunk());

    expect(await cache.get(oldest)).toBeNull();
    expect(await cache.get(newest)).toEqual(chunk());
  });
});
