export type LLMProvider = 'ollama' | 'anthropic' | 'apfel' | 'lmstudio';
export type LMStudioLoadStatus = 'idle' | 'loading' | 'loaded' | 'errored';

export interface LLMStatus {
  provider: string;
  model: string;
  ok: boolean;
  error?: string;
}
