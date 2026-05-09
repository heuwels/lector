import type { LLMProvider, CompletionOptions } from './types';

const DEFAULT_URL = 'http://localhost:1234';
const DEFAULT_TIMEOUT_MS = 60_000;

export interface LMStudioStatefulInput {
  input: string;
  systemPrompt?: string;
  previousResponseId?: string;
}

export interface LMStudioStatefulResult {
  content: string;
  responseId?: string;
}

export interface LMStudioLoadResult {
  ok: boolean;
  error?: string;
  instanceId?: string;
  loadTimeSeconds?: number;
}

/** Thrown when LM Studio rejects a previous_response_id (expired, unknown, server restart). */
export class LMStudioInvalidResponseIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LMStudioInvalidResponseIdError';
  }
}

export class LMStudioProvider implements LLMProvider {
  name = 'lmstudio';
  private baseUrl: string;
  private model: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(options?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    timeoutMs?: number;
  }) {
    this.baseUrl = (options?.baseUrl || process.env.LMSTUDIO_URL || DEFAULT_URL).replace(/\/$/, '');
    this.model = options?.model || process.env.LMSTUDIO_MODEL || '';
    this.apiKey = options?.apiKey || process.env.LMSTUDIO_API_KEY || undefined;
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

  /** Stateless chat completion via OpenAI-compat /v1/chat/completions. Used for definitions, translation, and as a fallback for the chat widget. */
  async complete(options: CompletionOptions): Promise<string> {
    const body = {
      model: this.model,
      messages: options.messages,
      max_tokens: options.maxTokens,
    };

    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LM Studio error: ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * Stateful chat via LM Studio's native /api/v1/chat. Used by the chat widget so
   * LM Studio manages context server-side (we just thread previous_response_id).
   * Throws LMStudioInvalidResponseIdError when previous_response_id is rejected,
   * so callers can fall back to stateless complete() with full history.
   */
  async chatStateful(input: LMStudioStatefulInput): Promise<LMStudioStatefulResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      input: input.input,
    };
    if (input.systemPrompt) body.system_prompt = input.systemPrompt;
    if (input.previousResponseId) body.previous_response_id = input.previousResponseId;

    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/v1/chat`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (input.previousResponseId && isInvalidResponseIdError(response.status, errorText)) {
        throw new LMStudioInvalidResponseIdError(errorText);
      }
      throw new Error(`LM Studio error: ${errorText}`);
    }

    const data = await response.json();
    const content = extractMessageContent(data);
    const responseId: string | undefined = typeof data.response_id === 'string' ? data.response_id : undefined;
    return { content, responseId };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: this.headers(),
      });
      if (!response.ok) {
        return { ok: false, error: `LM Studio returned ${response.status}` };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: `Cannot reach LM Studio at ${this.baseUrl}` };
    }
  }

  /** Returns the list of model identifiers known to LM Studio (loaded or available). */
  async listModels(): Promise<string[]> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/models`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LM Studio /v1/models error: ${error}`);
    }
    const data = await response.json();
    const items: unknown[] = Array.isArray(data?.data) ? data.data : [];
    return items
      .map((item) => (typeof item === 'object' && item && 'id' in item ? String((item as { id: unknown }).id) : ''))
      .filter((id) => id.length > 0);
  }

  /** Synchronously loads a model into LM Studio. Resolves once the model is loaded (or fails). */
  async loadModel(modelId: string): Promise<LMStudioLoadResult> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/v1/models/load`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: modelId }),
      });
      if (!response.ok) {
        const error = await response.text();
        return { ok: false, error: error || `Status ${response.status}` };
      }
      const data = await response.json();
      return {
        ok: data?.status === 'loaded',
        instanceId: typeof data?.instance_id === 'string' ? data.instance_id : undefined,
        loadTimeSeconds: typeof data?.load_time_seconds === 'number' ? data.load_time_seconds : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error: message };
    }
  }
}

function extractMessageContent(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const output = (data as { output?: unknown }).output;
  if (!Array.isArray(output)) return '';
  for (const item of output) {
    if (
      item &&
      typeof item === 'object' &&
      (item as { type?: unknown }).type === 'message' &&
      typeof (item as { content?: unknown }).content === 'string'
    ) {
      return (item as { content: string }).content;
    }
  }
  return '';
}

function isInvalidResponseIdError(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes('previous_response_id') ||
    lower.includes('response id') ||
    lower.includes('response_id')
  );
}
