import type { LLMProvider, CompletionOptions } from './types';

const DEFAULT_URL = 'http://ollama:11434';
const DEFAULT_MODEL = 'llama3.1:8b';

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseUrl: string;
  private model: string;

  constructor(baseUrl?: string, model?: string) {
    this.baseUrl = (baseUrl || process.env.OLLAMA_URL || DEFAULT_URL).replace(/\/$/, '');
    this.model = model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;
  }

  async complete(options: CompletionOptions): Promise<string> {
    const body = {
      model: this.model,
      messages: options.messages,
      stream: false,
      format: 'json',
      options: {
        num_predict: options.maxTokens,
      },
    };

    let response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // Auto-pull model if not found
    if (!response.ok) {
      const error = await response.text();
      if (error.includes('not found') || error.includes('pull')) {
        console.log(`Pulling model ${this.model}...`);
        await this.pullModel();
        response = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama error: ${error}`);
    }

    const data = await response.json();
    return data.message?.content || '';
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        return { ok: false, error: `Ollama returned ${response.status}` };
      }
      const data = await response.json();
      const models = (data.models || []).map((m: { name: string }) => m.name);
      return {
        ok: true,
        ...(models.length === 0 ? { error: `No models loaded. Will pull ${this.model} on first use.` } : {}),
      };
    } catch (err) {
      return { ok: false, error: `Cannot reach Ollama at ${this.baseUrl}` };
    }
  }

  private async pullModel(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.model, stream: false }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to pull model ${this.model}: ${error}`);
    }
  }
}
