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
export type LLMTask = 'word-translation' | 'phrase-translation' | 'chat';

export interface CompletionOptions {
  messages: ChatMessage[];
  maxTokens: number;
  /** Optional task hint for per-task model selection (Anthropic only for now). */
  task?: LLMTask;
  /**
   * Whether the caller needs a structured JSON object back. Routes that
   * `JSON.parse()` the result (translate, journal-correct) pass 'json' so the
   * provider requests OpenAI JSON mode; prose callers (explain, chat) leave it
   * 'text'. Defaults to 'text' — providers only constrain the format on demand.
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
