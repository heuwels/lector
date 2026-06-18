import type { LLMProvider, CompletionOptions } from './types';

const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_TIMEOUT_MS = 60_000;

export interface OpenAICompatibleOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * One provider for every OpenAI-compatible HTTP backend — Ollama, LM Studio,
 * Apfel, vLLM, llama.cpp, LiteLLM, etc. They all expose `/v1/chat/completions`
 * and `/v1/models`, so a single endpoint + optional API key + model name is all
 * we need. (Anthropic stays separate: it has OAuth, the Agent SDK path, and
 * per-task models — none of which fit this shape.)
 */
export class OpenAICompatibleProvider implements LLMProvider {
  name = 'openai';
  readonly model: string;
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(options?: OpenAICompatibleOptions) {
    this.baseUrl = (options?.baseUrl || process.env.OPENAI_COMPAT_URL || DEFAULT_URL).replace(/\/$/, '');
    this.model = options?.model || process.env.OPENAI_COMPAT_MODEL || '';
    this.apiKey = options?.apiKey || process.env.OPENAI_COMPAT_API_KEY || undefined;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(options: CompletionOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: options.messages,
      max_tokens: options.maxTokens,
    };
    // Only constrain the output when the caller will JSON.parse it. Verified that
    // Ollama, LM Studio, and Apfel all honor OpenAI JSON mode on /v1.
    if (options.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM provider error: ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: this.headers(),
      });
      if (!response.ok) {
        return { ok: false, error: `Provider returned ${response.status}` };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: `Cannot reach LLM provider at ${this.baseUrl}` };
    }
  }

  /** Model identifiers the endpoint reports (loaded or available). Empty list on a server that doesn't enumerate. */
  async listModels(): Promise<string[]> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/models`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`/v1/models error: ${error}`);
    }
    const data = await response.json();
    const items: unknown[] = Array.isArray(data?.data) ? data.data : [];
    return items
      .map((item) => (typeof item === 'object' && item && 'id' in item ? String((item as { id: unknown }).id) : ''))
      .filter((id) => id.length > 0);
  }
}
