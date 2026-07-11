export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * What a completion is for, so a provider can pick a task-appropriate model.
 * Only AnthropicProvider acts on this today (per-task model config); other
 * providers ignore it and use their single configured model.
 * TODO(backlog): generalise per-task model selection to all providers.
 */
export type LLMTask = 'word-translation' | 'phrase-translation' | 'chat' | 'word-classification';

export type CompletionResponseFormat = 'json-object' | 'json-array' | 'text';

export interface CompletionOptions {
  messages: ChatMessage[];
  maxTokens: number;
  /** Optional task hint for per-task model selection (Anthropic only for now). */
  task?: LLMTask;
  /**
   * Expected response shape. Generic providers do not turn this into a
   * server-side JSON-mode flag because no response_format value works across
   * all backends (LM Studio rejects json_object, Ollama ignores json_schema).
   * Explicitly verified API profiles may act on the hint; callers still parse
   * and validate the returned root shape locally.
   */
  responseFormat?: CompletionResponseFormat;
}

export interface LLMProvider {
  name: string;
  /** The configured model identifier, surfaced for status reporting. */
  model?: string;
  complete(options: CompletionOptions): Promise<string>;
  /**
   * Stream a completion as incremental text deltas — used by the latency-sensitive
   * word-gloss path so the reader sees the translation form as it generates rather
   * than waiting for the whole response. Yields text *fragments* (not cumulative);
   * callers concatenate. Providers that can't truly stream (e.g. the Anthropic
   * Agent-SDK/OAuth path) may buffer and yield once — the contract is only that the
   * concatenation equals what complete() would have returned.
   */
  stream(options: CompletionOptions): AsyncIterable<string>;
  /** Check if the provider is reachable and configured */
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
}
