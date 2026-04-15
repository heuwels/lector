import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, CompletionOptions } from './types';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    const oauthToken =
      process.env.CLAUDE_OAUTH_TOKEN ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN ||
      process.env.ANTHROPIC_AUTH_TOKEN;

    if (oauthToken) {
      this.client = new Anthropic({ authToken: oauthToken, apiKey: undefined as unknown as string });
    } else {
      this.client = new Anthropic(apiKey ? { apiKey } : undefined);
    }
    this.model = model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  }

  async complete(options: CompletionOptions): Promise<string> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens,
      messages: options.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic');
    }

    return content.text;
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      // Verify the API key works with a minimal request
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error: message };
    }
  }
}
