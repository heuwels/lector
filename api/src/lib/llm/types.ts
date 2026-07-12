export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * What a completion is for, so a provider can pick a task-appropriate model.
 * Providers may use this to select a task-appropriate model. The route owns
 * the task: clients never get to choose a cheaper model or richer response by
 * sending a task name.
 */
export type LLMTask =
  | 'word-gloss'
  | 'word-enrichment'
  | 'context-simple'
  | 'context-rich'
  | 'phrase-simple'
  | 'phrase-rich'
  | 'chat'
  | 'word-classification';

/** Cost-safe, text-free telemetry for one upstream provider attempt. */
export interface LLMUsageEvent {
  task?: LLMTask;
  model: string;
  attempt: number;
  latencyMs: number;
  success: boolean;
  usageAvailable: boolean;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

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
  /** Internal retry ordinal; completeJson increments it for its second call. */
  attempt?: number;
  /** Optional observer for provider usage. Never receives prompts or output. */
  onUsage?: (event: LLMUsageEvent) => void;
}

/** One request inside a provider batch job (see LLMProvider.createBatch). */
export interface BatchRequest {
  /** Caller-chosen id echoed back with the result; unique within the batch. */
  customId: string;
  options: CompletionOptions;
}

/**
 * Lifecycle of a submitted batch. `ended` carries only the requests that
 * SUCCEEDED (customId → raw completion text) — errored/expired entries are
 * simply absent, and the caller decides whether to resubmit them. `failed`
 * is terminal for the whole batch (unknown/expired batch id): the caller
 * should discard its bookkeeping and start over.
 */
export type BatchStatus =
  | { state: 'in_progress' }
  | { state: 'ended'; results: Map<string, string> }
  | { state: 'failed'; error: string };

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
  /**
   * Optional async-batch surface (50%-off tier, e.g. Anthropic Message
   * Batches). Absent or supportsBatch() === false on providers without one
   * (OpenAI-compatible backends have no universal batch endpoint) — callers
   * must feature-detect and fall back to complete(). Batches are minutes-to-
   * hours async: submit with createBatch, then poll getBatch until it leaves
   * 'in_progress'. Transient errors (network) throw; a batch the provider no
   * longer knows resolves to state 'failed'.
   */
  supportsBatch?(): boolean;
  createBatch?(requests: BatchRequest[]): Promise<string>;
  getBatch?(batchId: string): Promise<BatchStatus>;
}
