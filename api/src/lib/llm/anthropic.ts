import Anthropic from '@anthropic-ai/sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { LLMProvider, CompletionOptions, LLMTask } from './types';

// General-purpose default. Use a plain alias (no date suffix) so it doesn't get
// retired out from under us the way a pinned snapshot does — that's exactly what
// happened to the old `claude-sonnet-4-20250514`, which started 404-ing.
const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface AnthropicProviderOptions {
  apiKey?: string;
  oauthToken?: string;
  /** General default model, used for any task without a more specific override. */
  model?: string;
  /** Single-word translation — high volume, cheap (e.g. claude-haiku-4-5). */
  wordModel?: string;
  /** Phrase / in-context translation — wants more nuance (e.g. sonnet/opus). */
  phraseModel?: string;
  /** LLM tutor chat. */
  chatModel?: string;
}

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic | null = null;
  private models: { default: string; word: string; phrase: string; chat: string };
  private useAgentSdk: boolean;

  constructor(options?: AnthropicProviderOptions) {
    const oauthToken =
      options?.oauthToken ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN ||
      process.env.CLAUDE_OAUTH_TOKEN ||
      process.env.ANTHROPIC_AUTH_TOKEN;

    const apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY;

    // OAuth tokens no longer work with the Messages API directly.
    // Use the Agent SDK (which handles OAuth internally) when we have an OAuth token.
    // Use the Anthropic SDK directly only with API keys.
    if (apiKey) {
      this.useAgentSdk = false;
      this.client = new Anthropic({ apiKey });
    } else if (oauthToken) {
      this.useAgentSdk = true;
      this.client = null;
    } else {
      this.useAgentSdk = false;
      this.client = new Anthropic();
    }

    // Per-task models fall back to the general default when their env var /
    // option is unset, so the app works out of the box and you opt into a
    // cheaper/smarter tier per task. TODO(backlog): surface these in the
    // Settings UI and support per-task models for all providers, not just Anthropic.
    const base = options?.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
    this.models = {
      default: base,
      word: options?.wordModel || process.env.ANTHROPIC_WORD_MODEL || base,
      phrase: options?.phraseModel || process.env.ANTHROPIC_PHRASE_MODEL || base,
      chat: options?.chatModel || process.env.ANTHROPIC_CHAT_MODEL || base,
    };
  }

  /** The general-default model, surfaced for status reporting. */
  get model(): string {
    return this.models.default;
  }

  /** Resolve which model to use for a given task (see CompletionOptions.task). */
  modelForTask(task?: LLMTask): string {
    switch (task) {
      case 'word-translation':
        return this.models.word;
      case 'phrase-translation':
        return this.models.phrase;
      case 'chat':
        return this.models.chat;
      default:
        return this.models.default;
    }
  }

  async complete(options: CompletionOptions): Promise<string> {
    const model = this.modelForTask(options.task);
    if (this.useAgentSdk) {
      return this.completeViaAgentSdk(options, model);
    }
    return this.completeViaApi(options, model);
  }

  private async completeViaApi(options: CompletionOptions, model: string): Promise<string> {
    const message = await this.client!.messages.create({
      model,
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

  private async completeViaAgentSdk(options: CompletionOptions, model: string): Promise<string> {
    // Build a single prompt from the messages
    const prompt = options.messages
      .map((m) => m.content)
      .join('\n\n');

    let resultText = '';

    for await (const message of query({
      prompt,
      options: {
        model,
        maxTurns: 1,
        systemPrompt: options.messages.find(m => m.role === 'system')?.content || undefined,
        allowedTools: [],
        permissionMode: 'bypassPermissions',
      },
    })) {
      if (message.type === 'assistant') {
        const content = (message as { message?: { content?: Array<{ type: string; text?: string }> } }).message?.content;
        if (content) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              resultText += block.text;
            }
          }
        }
      }
      if (message.type === 'result') {
        const result = (message as { result?: string }).result;
        if (result) {
          resultText = result;
        }
      }
    }

    if (!resultText) {
      throw new Error('No text response from Agent SDK');
    }

    return resultText;
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.complete({
        messages: [{ role: 'user', content: 'Respond with just the word "ok"' }],
        maxTokens: 10,
      });
      return { ok: result.length > 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error: message };
    }
  }
}
