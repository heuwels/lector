import '../../test-guard';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { splitAudio } from './split-audio';
import { probeAudioDurationMs } from '../audio-probe';

// Splitting is entirely ffmpeg's behaviour — container quirks (mp3 frame
// boundaries, m4a needing its own moov per piece, ogg page alignment) are
// exactly what a stubbed test would miss, so these drive the real binary.
// Skipped when ffmpeg isn't installed locally; CI installs it to keep them
// exercised, same arrangement as the espeak-ng TTS tests.
const hasFfmpeg = Bun.which('ffmpeg') !== null;

const TEST_DIR = path.join(process.env.DATA_DIR || '.test-data', 'split-audio');
const CLIP_SECONDS = 95;

/** A `CLIP_SECONDS` sine tone in `extension`'s container. */
async function tone(extension: string, codec: string, bitrate: string): Promise<string> {
  const filePath = path.join(TEST_DIR, `tone${extension}`);
  const proc = Bun.spawn(
    [
      ...['ffmpeg', '-v', 'error', '-y'],
      ...['-f', 'lavfi', '-i', `sine=frequency=440:duration=${CLIP_SECONDS}`],
      ...['-c:a', codec, ...(bitrate ? ['-b:a', bitrate] : [])],
      filePath,
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  await proc.exited;
  if (proc.exitCode !== 0) throw new Error(`could not build the ${extension} fixture`);
  return filePath;
}

beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});
afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe.skipIf(!hasFfmpeg)('splitAudio', () => {
  test('cuts into contiguous pieces whose offsets cover the whole recording', async () => {
    const { chunks, cleanup } = await splitAudio(await tone('.mp3', 'libmp3lame', '64k'), 30);
    try {
      expect(chunks.length).toBe(4); // 30 + 30 + 30 + 5
      expect(chunks[0].startMs).toBe(0);
      // No gaps and no overlap: each piece starts where the previous ended.
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].startMs).toBe(chunks[i - 1].endMs);
      }
      const totalMs = chunks[chunks.length - 1].endMs;
      expect(Math.abs(totalMs - CLIP_SECONDS * 1000)).toBeLessThan(500);
    } finally {
      cleanup();
    }
  });

  test('every piece is independently decodable, in each container we accept', async () => {
    for (const [extension, codec, bitrate] of [
      ['.mp3', 'libmp3lame', '64k'],
      ['.m4a', 'aac', '64k'],
      ['.opus', 'libopus', '24k'],
      ['.wav', 'pcm_s16le', ''],
    ] as const) {
      const { chunks, cleanup } = await splitAudio(await tone(extension, codec, bitrate), 30);
      try {
        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) {
          // A stream copy that produced a headerless fragment would still be a
          // file on disk — ffprobe reading a duration back is the real check.
          const probed = await probeAudioDurationMs(chunk.path);
          expect(probed).not.toBeNull();
          const expected = chunk.endMs - chunk.startMs;
          expect(Math.abs((probed as number) - expected)).toBeLessThan(500);
        }
      } finally {
        cleanup();
      }
    }
  }, 30_000);

  test('cleans up its temp directory', async () => {
    const { chunks, cleanup } = await splitAudio(await tone('.mp3', 'libmp3lame', '64k'), 30);
    const chunkDir = path.dirname(chunks[0].path);
    expect(fs.existsSync(chunkDir)).toBe(true);
    cleanup();
    expect(fs.existsSync(chunkDir)).toBe(false);
  });

  test('throws rather than silently returning the unsplit file', async () => {
    const notAudio = path.join(TEST_DIR, 'not-audio.mp3');
    await Bun.write(notAudio, 'this is not an audio file');
    await expect(splitAudio(notAudio, 30)).rejects.toThrow('could not split');
  });
});
