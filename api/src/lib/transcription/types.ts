/** One timestamped segment as returned by the ASR backend (utterance/sentence level). */
export interface TranscriptionSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptionResult {
  /** The full flowing transcript (what becomes the lesson's textContent). */
  text: string;
  /** Timestamped segments in playback order — the listen-along sync data. */
  segments: TranscriptionSegment[];
  /** Audio duration when the backend reports it (verbose_json `duration`). */
  durationMs?: number;
}

export interface TranscribeOptions {
  /**
   * ISO-639-1 language hint. Always passed — Whisper mis-detects Afrikaans as
   * Dutch on auto-detect, so auto-detection is never relied on.
   */
  language: string;
  /**
   * Original filename for the multipart file part; backends sniff the audio
   * container format from its extension.
   */
  filename: string;
}

/**
 * ASR abstraction, parallel to LLMProvider (which is completion-only and can't
 * express audio→text). One implementation covers every OpenAI-compatible
 * `/v1/audio/transcriptions` backend — local Speaches / faster-whisper-server,
 * OpenAI, Groq — so the backend is a config choice, not a code fork.
 */
export interface TranscriptionProvider {
  name: string;
  /** The configured model identifier, surfaced for status reporting. */
  model: string;
  /**
   * Per-request upload cap when the backend has one (hosted APIs); undefined
   * for local servers, which have no cap. Callers gate any chunking fallback
   * on this — chunking is never on the local happy path.
   */
  maxBytes?: number;
  transcribe(audio: Blob, options: TranscribeOptions): Promise<TranscriptionResult>;
  /** Check if the ASR backend is reachable and configured. */
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
}
