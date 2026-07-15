import { OpenAIWhisperProvider } from './openai-whisper';
import type { TranscriptionProvider } from './types';

export type {
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionSegment,
} from './types';
export { OpenAIWhisperProvider } from './openai-whisper';

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
 * - Hosted fallback (e.g. Groq): `ASR_URL=https://api.groq.com/openai` +
 *   `ASR_API_KEY`, and set `ASR_MAX_BYTES` to the service's upload cap so
 *   oversized files fail fast with a clear error instead of a provider 4xx.
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

/** Clear the cached provider (tests / env changes). */
export function resetTranscriptionProvider(): void {
  cachedProvider = null;
  cachedProviderKey = null;
}
