import '../../test-guard';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { DEFAULT_MAX_CHUNK_SECONDS, planChunkSeconds, transcribeChunked } from './chunked';
import type { SplitAudioFn } from './split-audio';
import type { TranscribeOptions, TranscriptionResult } from './types';

const TEST_DIR = path.join(process.env.DATA_DIR || '.test-data', 'chunked');
const OPTIONS: TranscribeOptions = { language: 'af', filename: 'clip.mp3' };

const MB = 1024 * 1024;

async function chunkFile(name: string, bytes: number): Promise<string> {
  const filePath = path.join(TEST_DIR, name);
  await Bun.write(filePath, new Uint8Array(bytes).fill(3));
  return filePath;
}

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});
afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('planChunkSeconds', () => {
  test('converts the byte cap to seconds at the file average bitrate', () => {
    // 60 MB over 60 min = 1 MB/min. A 25 MB cap with 10% headroom is 22.5 min,
    // but the processing-timeout clamp caps it at 10 min.
    expect(
      planChunkSeconds({
        fileBytes: 60 * MB,
        durationMs: 3600_000,
        chunkBytes: 25 * MB,
        maxChunkSeconds: 3600,
      }),
    ).toBe(1350);
  });

  test('clamps to the processing-timeout ceiling', () => {
    expect(
      planChunkSeconds({ fileBytes: 60 * MB, durationMs: 3600_000, chunkBytes: 25 * MB }),
    ).toBe(DEFAULT_MAX_CHUNK_SECONDS);
  });

  test('never plans a chunk shorter than the 30 s floor', () => {
    // Absurdly high bitrate: the byte budget alone would ask for a few seconds.
    expect(planChunkSeconds({ fileBytes: 100 * MB, durationMs: 60_000, chunkBytes: 1 * MB })).toBe(
      30,
    );
  });

  test('is null when the duration is unknown, so bytes cannot become time', () => {
    expect(
      planChunkSeconds({ fileBytes: 60 * MB, durationMs: null, chunkBytes: 25 * MB }),
    ).toBeNull();
    expect(planChunkSeconds({ fileBytes: 60 * MB, durationMs: 0, chunkBytes: 25 * MB })).toBeNull();
  });
});

describe('transcribeChunked', () => {
  test('shifts each chunk onto the original timeline and joins the text', async () => {
    const chunks = [
      { path: await chunkFile('a.mp3', 128), startMs: 0, endMs: 30_000 },
      { path: await chunkFile('b.mp3', 128), startMs: 30_000, endMs: 61_500 },
    ];
    const split: SplitAudioFn = async () => ({ chunks, cleanup: () => {} });

    const filenames: string[] = [];
    const result = await transcribeChunked({
      filePath: 'whole.mp3',
      fileBytes: 256,
      durationMs: 61_500,
      chunkBytes: 200,
      transcribe: async (_audio, options): Promise<TranscriptionResult> => {
        filenames.push(options.filename);
        const n = filenames.length;
        return {
          text: `sin ${n}`,
          segments: [{ startMs: 500, endMs: 2500, text: `Sin ${n}.` }],
        };
      },
      options: OPTIONS,
      split,
    });

    expect(result.text).toBe('sin 1 sin 2');
    expect(result.segments).toEqual([
      { startMs: 500, endMs: 2500, text: 'Sin 1.' },
      { startMs: 30_500, endMs: 32_500, text: 'Sin 2.' },
    ]);
    // The split's own boundaries are the authoritative total duration.
    expect(result.durationMs).toBe(61_500);
    // Each part keeps the .mp3 extension so backends still sniff the container.
    expect(filenames).toEqual(['0-clip.mp3', '1-clip.mp3']);
  });

  test('cleans up the temp chunks even when a chunk fails', async () => {
    let cleaned = false;
    const split: SplitAudioFn = async () => ({
      chunks: [{ path: await chunkFile('c.mp3', 128), startMs: 0, endMs: 30_000 }],
      cleanup: () => {
        cleaned = true;
      },
    });

    await expect(
      transcribeChunked({
        filePath: 'whole.mp3',
        fileBytes: 256,
        durationMs: 30_000,
        chunkBytes: 200,
        transcribe: async () => {
          throw new Error('ASR provider returned 503');
        },
        options: OPTIONS,
        split,
      }),
    ).rejects.toThrow('503');
    expect(cleaned).toBe(true);
  });

  test('refuses a chunk that is still over the cap after splitting', async () => {
    const split: SplitAudioFn = async () => ({
      chunks: [{ path: await chunkFile('d.mp3', 4096), startMs: 0, endMs: 30_000 }],
      cleanup: () => {},
    });

    await expect(
      transcribeChunked({
        filePath: 'whole.mp3',
        fileBytes: 8192,
        durationMs: 30_000,
        chunkBytes: 1024,
        transcribe: async () => {
          throw new Error('should not be uploaded');
        },
        options: OPTIONS,
        split,
      }),
    ).rejects.toThrow('after splitting');
  });

  test('explains itself when the duration is unknown instead of splitting blind', async () => {
    await expect(
      transcribeChunked({
        filePath: 'whole.mp3',
        fileBytes: 8192,
        durationMs: null,
        chunkBytes: 1024,
        transcribe: async () => {
          throw new Error('should not be uploaded');
        },
        options: OPTIONS,
        split: async () => {
          throw new Error('should not be split');
        },
      }),
    ).rejects.toThrow('duration could not be probed');
  });
});
