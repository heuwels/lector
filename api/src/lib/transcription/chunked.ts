// Chunked transcription for files over the ASR provider's per-request cap (#185).
//
// The provider stays a dumb single-request client (openai-whisper.ts): it knows
// its cap but never splits. This module is the caller-side fallback the
// `TranscriptionProvider.maxBytes` doc refers to — it plans a cut, sends each
// piece over the same ordinary multipart path, and re-assembles one transcript
// on the original timeline. A local Whisper server reports no cap, so none of
// this runs on the local happy path.

import { splitAudio, type SplitAudioFn } from './split-audio';
import type { TranscribeOptions, TranscriptionResult, TranscriptionSegment } from './types';

/**
 * Headroom on the byte budget. Each chunk carries its own container header, and
 * a VBR stream's local bitrate runs above the file average in loud passages —
 * both push a chunk past a naively-exact split.
 */
const CHUNK_BYTE_SAFETY = 0.9;

/** Below this, per-chunk container overhead and boundary word-clipping dominate. */
const MIN_CHUNK_SECONDS = 30;

/**
 * How long one chunk of audio may be, independent of its size. Byte caps are
 * not the only ceiling: OpenRouter's upstreams abort after 60 s of *processing*,
 * and a fast hosted Whisper runs at roughly 20× realtime, so ~10 minutes of
 * audio is about as much as one request can clear. Override with
 * `ASR_CHUNK_SECONDS` when a backend is slower or has no timeout at all.
 */
export const DEFAULT_MAX_CHUNK_SECONDS = 600;

export interface ChunkPlanInput {
  fileBytes: number;
  /** Probed duration of the whole recording; chunking needs it to convert bytes to time. */
  durationMs: number | null;
  /** The provider's per-request upload cap. */
  chunkBytes: number;
  maxChunkSeconds?: number;
}

/**
 * Seconds of audio per chunk, or null when the recording's duration is unknown
 * (ffprobe missing or unreadable) and bytes therefore can't be converted to
 * time. Callers treat null as "cannot chunk this" and fail with that reason.
 */
export function planChunkSeconds({
  fileBytes,
  durationMs,
  chunkBytes,
  maxChunkSeconds = DEFAULT_MAX_CHUNK_SECONDS,
}: ChunkPlanInput): number | null {
  if (!durationMs || durationMs <= 0 || fileBytes <= 0 || chunkBytes <= 0) return null;
  const durationSeconds = durationMs / 1000;
  const bytesPerSecond = fileBytes / durationSeconds;
  const byBytes = Math.floor((chunkBytes * CHUNK_BYTE_SAFETY) / bytesPerSecond);
  return Math.max(MIN_CHUNK_SECONDS, Math.min(byBytes, maxChunkSeconds));
}

export interface TranscribeChunkedOptions {
  filePath: string;
  fileBytes: number;
  durationMs: number | null;
  chunkBytes: number;
  maxChunkSeconds?: number;
  transcribe: (audio: Blob, options: TranscribeOptions) => Promise<TranscriptionResult>;
  options: TranscribeOptions;
  /** Injectable for tests — the real one shells out to ffmpeg. */
  split?: SplitAudioFn;
}

/**
 * Split, transcribe each piece over the normal multipart request, and stitch.
 *
 * Chunks go one at a time rather than in parallel: hosted ASR endpoints are
 * rate-limited per key, the worker already transcribes one lesson per tick, and
 * a serial walk keeps peak memory at one chunk regardless of file length.
 */
export async function transcribeChunked({
  filePath,
  fileBytes,
  durationMs,
  chunkBytes,
  maxChunkSeconds,
  transcribe,
  options,
  split = splitAudio,
}: TranscribeChunkedOptions): Promise<TranscriptionResult> {
  const segmentSeconds = planChunkSeconds({ fileBytes, durationMs, chunkBytes, maxChunkSeconds });
  if (segmentSeconds === null) {
    throw new Error(
      'Audio is above the ASR provider upload cap and its duration could not be probed, so it cannot be split — install ffmpeg or re-encode the file smaller',
    );
  }

  const { chunks, cleanup } = await split(filePath, segmentSeconds);
  try {
    const segments: TranscriptionSegment[] = [];
    const texts: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const file = Bun.file(chunk.path);
      if (file.size > chunkBytes) {
        throw new Error(
          `Chunk ${i + 1} is still ${Math.round(file.size / 1024 / 1024)} MB after splitting, above the provider's ${Math.round(chunkBytes / 1024 / 1024)} MB cap — re-encode the file at a lower bitrate`,
        );
      }
      const result = await transcribe(file, {
        ...options,
        // Keep the container extension: backends sniff the format from it.
        filename: `${i}-${options.filename}`,
      });
      for (const segment of result.segments) {
        segments.push({
          startMs: segment.startMs + chunk.startMs,
          endMs: segment.endMs + chunk.startMs,
          text: segment.text,
        });
      }
      if (result.text.trim()) texts.push(result.text.trim());
    }

    const text = texts.join(' ').trim();
    if (!text) throw new Error('ASR provider returned an empty transcript');
    return {
      text,
      segments,
      // The split's own boundaries are a better total than the sum of what the
      // backend reports per chunk, which excludes trailing silence.
      durationMs: chunks[chunks.length - 1].endMs,
    };
  } finally {
    cleanup();
  }
}
