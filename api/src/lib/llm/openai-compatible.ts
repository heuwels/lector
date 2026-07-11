import type { LLMProvider, CompletionOptions } from './types';
import { LLMTruncatedError } from './errors';

const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_TIMEOUT_MS = 60_000;

export type OpenAICompatibleProfile = 'generic' | 'openrouter';

export interface OpenAICompatibleOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Opt into request fields verified for a specific API/model pair. */
  profile?: OpenAICompatibleProfile;
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
  private profile: OpenAICompatibleProfile;

  constructor(options?: OpenAICompatibleOptions) {
    this.baseUrl = (options?.baseUrl || process.env.OPENAI_COMPAT_URL || DEFAULT_URL).replace(
      /\/$/,
      '',
    );
    this.model = options?.model || process.env.OPENAI_COMPAT_MODEL || '';
    this.apiKey = options?.apiKey || process.env.OPENAI_COMPAT_API_KEY || undefined;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.profile = options?.profile ?? 'generic';
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private usesMaxCompletionTokens(): boolean {
    // OpenRouter's route capability filter still advertises max_tokens for
    // several catalog models. GPT-5 is the model we have verified requires the
    // newer field; using it gateway-wide can make require_parameters reject
    // otherwise valid Gemini/Mistral/Gemma routes.
    // BYOK model IDs are allowlisted exactly; future GPT-5 variants must be
    // evaluated and added deliberately rather than inheriting this implicitly.
    return this.profile === 'openrouter' && this.model === 'openai/gpt-5';
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

  private async requestCompletion(options: CompletionOptions): Promise<string> {
    const maxTokens = options.maxTokens;
    const body: Record<string, unknown> = { model: this.model, messages: options.messages };
    if (this.usesMaxCompletionTokens()) body.max_completion_tokens = maxTokens;
    else body.max_tokens = maxTokens;
    // No response_format value works across every compatible backend: LM Studio
    // rejects json_object and Ollama ignores json_schema. Keep prompt-driven JSON
    // as the default, and use server-side JSON only for an explicitly
    // known-capable endpoint.
    if (this.profile === 'openrouter' && options.responseFormat === 'json-object') {
      body.response_format = { type: 'json_object' };
      body.provider = { require_parameters: true };
      if (this.model === 'openai/gpt-5' && options.task === 'phrase-translation') {
        // Keep the quality-affecting reasoning override on the observed phrase
        // path; other tasks retain the model default until separately evaluated.
        body.reasoning = { effort: 'minimal' };
      }
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
    if (data.error) {
      const detail = data.error.message || data.error.code || 'Unknown provider error';
      throw new Error(`LLM provider error: ${detail}`);
    }
    const choice = data.choices?.[0];
    if (choice?.error || choice?.finish_reason === 'error') {
      const detail =
        choice?.error?.message || choice?.native_finish_reason || 'Unknown provider error';
      throw new Error(`LLM provider error: ${detail}`);
    }
    if (
      (options.responseFormat === 'json-object' || options.responseFormat === 'json-array') &&
      choice?.finish_reason === 'length'
    ) {
      throw new LLMTruncatedError(maxTokens);
    }
    return choice?.message?.content || '';
  }

  async complete(options: CompletionOptions): Promise<string> {
    return this.requestCompletion(options);
  }

  /**
   * Stream a completion via `stream: true`. The server sends SSE frames
   * (`data: {json}\n\n`, terminated by `data: [DONE]`); we parse each line,
   * pull `choices[0].delta.content`, and yield it. Note fetchWithTimeout only
   * bounds the time-to-headers — once the response resolves the abort timer is
   * cleared, so a long stream body isn't cut off mid-generation.
   */
  async *stream(options: CompletionOptions): AsyncGenerator<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: options.messages,
      stream: true,
    };
    if (this.usesMaxCompletionTokens()) body.max_completion_tokens = options.maxTokens;
    else body.max_tokens = options.maxTokens;

    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const error = response.ok
        ? 'no response body'
        : await response.text().catch(() => `HTTP ${response.status}`);
      throw new Error(`LLM provider error: ${error}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are newline-delimited; process every complete line and
        // keep the trailing partial in the buffer for the next chunk.
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue; // skip blank lines / comments
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta as string;
          } catch {
            // keep-alive ping or non-JSON line — ignore
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
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
      .map((item) =>
        typeof item === 'object' && item && 'id' in item
          ? String((item as { id: unknown }).id)
          : '',
      )
      .filter((id) => id.length > 0);
  }
}
