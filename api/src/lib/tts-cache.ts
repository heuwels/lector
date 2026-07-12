// Content-addressed cache for synthesized TTS audio (#226). Google charges per
// synthesized character and the same (language, voice, rate, text) tuple always
// yields the same MP3, so every replay of a cached tuple is pure waste — vocab
// and sentences overlap heavily across users, and read-along re-reads the same
// article. The cache is shared across tenants BY DESIGN: audio is derivable by
// any user who knows the text, so serving user B the bytes user A's request
// synthesized leaks nothing and is exactly where the 80–95% saving comes from.
//
// Backends, resolved from env at first use:
//   - `TTS_CACHE=0`               — disabled (every request synthesizes).
//   - `TTS_CACHE_S3_BUCKET=…`     — object storage via Bun's built-in S3 client
//     (cloud). Region/credentials come from the standard AWS/S3 env vars or the
//     TTS_CACHE_S3_* overrides below; TTS_CACHE_S3_ENDPOINT supports any
//     S3-compatible store (R2, MinIO). No lifecycle management here — cap the
//     bucket with an S3 lifecycle rule instead.
//   - otherwise                   — DATA_DIR/tts-cache on disk (self-host
//     default, zero config), LRU-capped at TTS_CACHE_MAX_BYTES (default 1 GiB).
//
// Cache failures must never fail a TTS request: get() degrades to a miss and
// put() to a no-op, logging at most once a minute so a broken backend doesn't
// flood the logs at read-along request rates.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { S3Client } from 'bun';

export interface TtsCacheKeyParts {
  /** App language code (e.g. 'af') — kept in the key and the object path. */
  language: string;
  /** Full voice identity, e.g. 'af-ZA:af-ZA-Standard-A' (ttsCode:ttsVoice). */
  voice: string;
  /** Speaking rate as sent to Google — different rates are different audio. */
  rate: number;
  text: string;
}

export interface TtsCacheKey {
  hash: string;
  /** Relative object key, e.g. 'af/3f2a….mp3' (backends add their own root). */
  objectKey: string;
}

/**
 * The issue's (lang, voice, sha(text)) key, hardened: rate participates too,
 * because Google renders a different waveform per speakingRate, and the whole
 * tuple is hashed as versioned JSON so a future format change can't collide
 * with old entries.
 */
export function ttsCacheKey(parts: TtsCacheKeyParts): TtsCacheKey {
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        v: 1,
        language: parts.language,
        voice: parts.voice,
        rate: parts.rate.toFixed(2),
        text: parts.text,
      }),
    )
    .digest('hex');
  // Shard by language then by the first hash byte: debuggable per-language
  // prefixes for ops (S3 lifecycle rules, du -sh), no giant flat directories.
  return { hash, objectKey: `${parts.language}/${hash.slice(0, 2)}/${hash}.mp3` };
}

export interface TtsCache {
  backend: 'disk' | 's3' | 'off';
  /** Cached MP3 bytes, or null on miss or any backend error. */
  get(key: TtsCacheKey): Promise<Uint8Array | null>;
  /** Best-effort store; never throws. */
  put(key: TtsCacheKey, bytes: Uint8Array): Promise<void>;
}

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024; // 1 GiB ≈ tens of thousands of clips
// How many written bytes may accumulate between disk-cap sweeps. Sweeping walks
// the whole cache dir, so amortize it rather than paying the walk per request.
const SWEEP_EVERY_BYTES = 32 * 1024 * 1024;

let lastErrorLogAt = 0;
function logCacheError(op: string, error: unknown): void {
  const now = Date.now();
  if (now - lastErrorLogAt < 60_000) return;
  lastErrorLogAt = now;
  console.error(`[tts-cache] ${op} failed (degrading to uncached):`, error);
}

const OFF_CACHE: TtsCache = {
  backend: 'off',
  get: async () => null,
  put: async () => {},
};

function makeS3Cache(bucket: string): TtsCache {
  // Explicit options win; anything undefined falls back to Bun's standard
  // S3_*/AWS_* env resolution. NB: Bun reads env credentials, not EC2 instance
  // profiles — deployments on an instance role must export static keys.
  const client = new S3Client({
    bucket,
    region: process.env.TTS_CACHE_S3_REGION || process.env.AWS_REGION || undefined,
    endpoint: process.env.TTS_CACHE_S3_ENDPOINT || undefined,
  });
  const prefix = (process.env.TTS_CACHE_S3_PREFIX ?? 'tts-cache/').replace(/\/?$/, '/');
  return {
    backend: 's3',
    async get(key) {
      try {
        // One round trip: fetch and treat NoSuchKey like any other miss.
        return new Uint8Array(await client.file(`${prefix}${key.objectKey}`).arrayBuffer());
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== 'NoSuchKey' && code !== 'KeyNotFound') logCacheError('s3 get', error);
        return null;
      }
    },
    async put(key, bytes) {
      try {
        await client.write(`${prefix}${key.objectKey}`, bytes, { type: 'audio/mpeg' });
      } catch (error) {
        logCacheError('s3 put', error);
      }
    },
  };
}

function makeDiskCache(root: string, maxBytes: number): TtsCache {
  let bytesSinceSweep = Number.POSITIVE_INFINITY; // force a sweep on first put
  let sweeping = false;
  // Sweep at least every quarter-cap so small caps stay accurate; large caps
  // amortize the directory walk to once per SWEEP_EVERY_BYTES written.
  const sweepThreshold = Math.min(SWEEP_EVERY_BYTES, Math.max(1, maxBytes / 4));

  const filePath = (key: TtsCacheKey) => path.join(root, key.objectKey);

  /** Walk the cache and delete oldest-read files until 10% under the cap. */
  async function enforceCap(): Promise<void> {
    if (sweeping) return;
    sweeping = true;
    try {
      const entries: { file: string; size: number; mtimeMs: number }[] = [];
      const dirents = await fs.promises
        .readdir(root, { recursive: true, withFileTypes: true })
        .catch(() => []);
      for (const dirent of dirents) {
        if (!dirent.isFile()) continue;
        // parentPath is the modern name; `path` is its pre-Node-20.12 alias.
        const parent = dirent.parentPath ?? (dirent as unknown as { path: string }).path;
        const file = path.join(parent, dirent.name);
        const stat = await fs.promises.stat(file).catch(() => null);
        if (stat) entries.push({ file, size: stat.size, mtimeMs: stat.mtimeMs });
      }
      let total = entries.reduce((sum, e) => sum + e.size, 0);
      if (total <= maxBytes) return;
      // mtime doubles as last-read time (get() touches on hit), so oldest
      // mtime ≈ least recently used. Evict to 90% so the next write doesn't
      // immediately re-trigger a full walk.
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const target = maxBytes * 0.9;
      for (const entry of entries) {
        if (total <= target) break;
        await fs.promises.rm(entry.file, { force: true }).catch(() => {});
        total -= entry.size;
      }
    } finally {
      bytesSinceSweep = 0;
      sweeping = false;
    }
  }

  return {
    backend: 'disk',
    async get(key) {
      try {
        const file = filePath(key);
        const bytes = await fs.promises.readFile(file);
        // Touch so the LRU sweep sees this entry as recently used.
        const now = new Date();
        fs.promises.utimes(file, now, now).catch(() => {});
        return new Uint8Array(bytes);
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') logCacheError('disk get', error);
        return null;
      }
    },
    async put(key, bytes) {
      try {
        const file = filePath(key);
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        // Write-then-rename so a crash mid-write can't leave a truncated MP3
        // that would be served as a cache hit forever.
        const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        await fs.promises.writeFile(tmp, bytes);
        await fs.promises.rename(tmp, file);
        bytesSinceSweep += bytes.byteLength;
        if (bytesSinceSweep >= sweepThreshold) await enforceCap();
      } catch (error) {
        logCacheError('disk put', error);
      }
    },
  };
}

let cached: TtsCache | null = null;

/**
 * Process-global cache instance, configured from env on first use.
 * resetTtsCache() re-reads the env (tests flip backends per case).
 */
export function getTtsCache(): TtsCache {
  if (cached) return cached;
  if (process.env.TTS_CACHE === '0') {
    cached = OFF_CACHE;
  } else if (process.env.TTS_CACHE_S3_BUCKET) {
    cached = makeS3Cache(process.env.TTS_CACHE_S3_BUCKET);
  } else {
    const dataDir = process.env.DATA_DIR || '../data'; // mirrors db.ts
    const maxBytes =
      parseInt(process.env.TTS_CACHE_MAX_BYTES || '', 10) > 0
        ? parseInt(process.env.TTS_CACHE_MAX_BYTES!, 10)
        : DEFAULT_MAX_BYTES;
    cached = makeDiskCache(path.join(dataDir, 'tts-cache'), maxBytes);
  }
  return cached;
}

export function resetTtsCache(): void {
  cached = null;
}
