import { OpenAIWhisperProvider } from './openai-whisper';
import { DEFAULT_MAX_CHUNK_SECONDS } from './chunked';
import type { TranscriptionProvider } from './types';

export type {
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionSegment,
} from './types';
export { OpenAIWhisperProvider } from './openai-whisper';
export { transcribeChunked, planChunkSeconds, DEFAULT_MAX_CHUNK_SECONDS } from './chunked';
export { splitAudio, type SplitAudioFn } from './split-audio';

let cachedProvider: TranscriptionProvider | null = null;
let cachedProviderKey: string | null = null;

/**
 * ASR backend for audio-lesson transcription (#185). Config, not code, picks
 * the backend — everything speaks OpenAI's `/v1/audio/transcriptions`:
 *
 * - Default: a Whisper server on this machine (Speaches / faster-whisper-server
 *   at localhost:8000). When Lector itself runs in Docker on a Mac, run the
 *   Whisper server NATIVELY on the host (containers get no Metal/GPU) and set
 *   `ASR_URL=http://host.docker.internal:8000` — the same trick as a host-run
 *   Ollama.
 * - Hosted fallback (e.g. OpenRouter, Groq): `ASR_URL=https://openrouter.ai/api`
 *   + `ASR_API_KEY`, and set `ASR_MAX_BYTES` to the service's PER-REQUEST
 *   multipart cap (OpenRouter and OpenAI: 25 MB). That cap no longer rejects a
 *   longer recording — it's the size the worker cuts chunks to, so a file up to
 *   `ASR_MAX_FILE_BYTES` transcribes as a series of ordinary multipart uploads.
 *
 * `ASR_MODEL` defaults to whisper-large-v3 — best Afrikaans accuracy, and the
 * cost delta vs Turbo is moot on a local server.
 */
export function getTranscriptionProvider(): TranscriptionProvider {
  const baseUrl = process.env.ASR_URL || undefined;
  const model = process.env.ASR_MODEL || undefined;
  const apiKey = process.env.ASR_API_KEY || undefined;
  const maxBytesRaw = parseInt(process.env.ASR_MAX_BYTES || '', 10);
  const maxBytes = Number.isFinite(maxBytesRaw) && maxBytesRaw > 0 ? maxBytesRaw : undefined;

  const cacheKey = `${baseUrl || 'default'}:${model || 'default'}:${apiKey ? 'keyed' : 'open'}:${maxBytes ?? 'uncapped'}`;
  if (cachedProvider && cachedProviderKey === cacheKey) return cachedProvider;
  cachedProvider = new OpenAIWhisperProvider({ baseUrl, model, apiKey, maxBytes });
  cachedProviderKey = cacheKey;
  return cachedProvider;
}

/**
 * Ceiling on a single lesson's audio, whatever the backend. Chunking removes
 * the provider's per-request cap as a limit, so something else has to bound the
 * work: 100 MB is ~2 h of 128 kbps mp3 or ~9 h of 24 kbps opus, well past any
 * realistic lesson, and it keeps a mistaken upload from queueing an hours-long
 * chain of ASR calls. Override with `ASR_MAX_FILE_BYTES`.
 */
export const DEFAULT_ASR_MAX_FILE_BYTES = 100 * 1024 * 1024;

export interface TranscriptionLimits {
  /** Hard reject above this — the whole recording, before splitting. */
  maxFileBytes: number;
  /** Upper bound on one chunk's audio length (provider processing timeouts). */
  maxChunkSeconds: number;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getTranscriptionLimits(): TranscriptionLimits {
  return {
    maxFileBytes: positiveInt(process.env.ASR_MAX_FILE_BYTES, DEFAULT_ASR_MAX_FILE_BYTES),
    maxChunkSeconds: positiveInt(process.env.ASR_CHUNK_SECONDS, DEFAULT_MAX_CHUNK_SECONDS),
  };
}

/** Clear the cached provider (tests / env changes). */
export function resetTranscriptionProvider(): void {
  cachedProvider = null;
  cachedProviderKey = null;
}
