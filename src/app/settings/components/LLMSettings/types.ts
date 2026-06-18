export type LLMProvider = 'anthropic' | 'openai';

/** UI-only convenience for the OpenAI-compatible panel — autofills the endpoint. Not read by the backend. */
export type OpenAIPreset = 'custom' | 'ollama' | 'lmstudio';

export interface LLMStatus {
  provider: string;
  model: string;
  ok: boolean;
  error?: string;
}
