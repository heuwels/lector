export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CompletionOptions {
  messages: ChatMessage[];
  maxTokens: number;
}

export interface LLMProvider {
  name: string;
  complete(options: CompletionOptions): Promise<string>;
  /** Check if the provider is reachable and configured */
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
}
