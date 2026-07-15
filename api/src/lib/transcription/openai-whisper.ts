import type {
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionSegment,
} from './types';

// Speaches / faster-whisper-server's default port; override with ASR_URL.
const DEFAULT_URL = 'http://localhost:8000';
const DEFAULT_MODEL = 'whisper-large-v3';
// Transcription is a background job, so the timeout only needs to beat the
// slowest realistic run (a podcast-length file on a cold-loaded local model),
// not feel snappy. 30 min is generous without letting a hung socket pin the
// worker forever.
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export interface OpenAIWhisperOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

interface VerboseJsonSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * One provider for every OpenAI-compatible `POST /v1/audio/transcriptions`
 * backend — local Speaches / faster-whisper-server, OpenAI, Groq. They all
 * accept the same multipart shape and return the same `verbose_json` body
 * (text + start/end-stamped segments), so an endpoint + optional API key +
 * model name is all we need.
 */
export class OpenAIWhisperProvider implements TranscriptionProvider {
  name = 'openai-whisper';
  readonly model: string;
  readonly maxBytes?: number;
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(options?: OpenAIWhisperOptions) {
    this.baseUrl = (options?.baseUrl || DEFAULT_URL).replace(/\/$/, '');
    this.model = options?.model || DEFAULT_MODEL;
    this.apiKey = options?.apiKey;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options?.maxBytes;
  }

  private headers(): Record<string, string> {
    // No Content-Type: fetch sets the multipart boundary itself.
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  async transcribe(audio: Blob, options: TranscribeOptions): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append('file', audio, options.filename);
    form.append('model', this.model);
    form.append('language', options.language);
    form.append('response_format', 'verbose_json');

    const response = await fetch(`${this.baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500);
      throw new Error(`ASR provider returned ${response.status}: ${detail}`);
    }

    const data = (await response.json()) as {
      text?: unknown;
      duration?: unknown;
      segments?: unknown;
    };
    const rawSegments: unknown[] = Array.isArray(data.segments) ? data.segments : [];
    const segments: TranscriptionSegment[] = rawSegments
      .filter(
        (s): s is VerboseJsonSegment =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as VerboseJsonSegment).start === 'number' &&
          typeof (s as VerboseJsonSegment).end === 'number' &&
          typeof (s as VerboseJsonSegment).text === 'string',
      )
      .map((s) => ({
        startMs: Math.round(s.start * 1000),
        endMs: Math.round(s.end * 1000),
        text: s.text.trim(),
      }))
      .filter((s) => s.text.length > 0);

    const text =
      typeof data.text === 'string' && data.text.trim().length > 0
        ? data.text.trim()
        : segments.map((s) => s.text).join(' ');
    if (!text) {
      throw new Error('ASR provider returned an empty transcript');
    }
    return {
      text,
      segments,
      durationMs: typeof data.duration === 'number' ? Math.round(data.duration * 1000) : undefined,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return { ok: false, error: `ASR provider returned ${response.status}` };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: `Cannot reach ASR provider at ${this.baseUrl}` };
    }
  }
}
