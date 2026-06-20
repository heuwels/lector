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

export interface CompletionOptions {
  messages: ChatMessage[];
  maxTokens: number;
  /** Optional task hint for per-task model selection (Anthropic only for now). */
  task?: LLMTask;
  /**
   * Hint that the caller will JSON.parse() the result (translate and
   * journal-correct pass 'json'; prose callers like explain/chat leave it
   * 'text'). Providers do NOT turn this into a server-side JSON-mode flag: no
   * response_format value works across all backends (LM Studio rejects
   * json_object, Ollama ignores json_schema), so JSON is enforced by the prompt
   * and read back with parseLooseJson(). Kept as a hint for possible future
   * per-provider handling.
   */
  responseFormat?: 'json' | 'text';
}

export interface LLMProvider {
  name: string;
  /** The configured model identifier, surfaced for status reporting. */
  model?: string;
  complete(options: CompletionOptions): Promise<string>;
  /** Check if the provider is reachable and configured */
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
}
