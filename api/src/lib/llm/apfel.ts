import type { LLMProvider, CompletionOptions } from './types';

const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'default';

export class ApfelProvider implements LLMProvider {
  name = 'apfel';
  private baseUrl: string;
  private model: string;

  constructor(baseUrl?: string, model?: string) {
    this.baseUrl = (baseUrl || process.env.APFEL_URL || DEFAULT_URL).replace(/\/$/, '');
    this.model = model || process.env.APFEL_MODEL || DEFAULT_MODEL;
  }

  async complete(options: CompletionOptions): Promise<string> {
    const body = {
      model: this.model,
      messages: options.messages,
      max_tokens: options.maxTokens,
      response_format: { type: 'json_object' },
    };

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Apfel error: ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`);
      if (!response.ok) {
        return { ok: false, error: `Apfel returned ${response.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Cannot reach Apfel at ${this.baseUrl}` };
    }
  }
}
