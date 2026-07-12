import Anthropic from '@anthropic-ai/sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { BatchRequest, BatchStatus, LLMProvider, CompletionOptions, LLMTask } from './types';
import { LLMTruncatedError } from './errors';

function expectsJson(options: CompletionOptions): boolean {
  return options.responseFormat === 'json-object' || options.responseFormat === 'json-array';
}

// General-purpose default. Use a plain alias (no date suffix) so it doesn't get
// retired out from under us the way a pinned snapshot does — that's exactly what
// happened to the old `claude-sonnet-4-20250514`, which started 404-ing.
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Word-domain classification is a high-volume background enum-pick — default it
// to the cheapest tier regardless of the general model, so a learner running
// Opus/Sonnet for translation doesn't pay top-tier rates per word classified.
const DEFAULT_CLASSIFICATION_MODEL = 'claude-haiku-4-5';

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
  /** Background word→domain classification — cheap, high volume (e.g. claude-haiku-4-5). */
  classificationModel?: string;
}

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic | null = null;
  private models: {
    default: string;
    word: string;
    phrase: string;
    chat: string;
    classification: string;
  };
  private useAgentSdk: boolean;
  private oauthToken: string | undefined;

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
      // Kept so completeViaAgentSdk can hand it to the SDK's subprocess env —
      // the subprocess does NOT see this provider's resolution (settings-stored
      // tokens and CLAUDE_OAUTH_TOKEN would otherwise be invisible to it, #247).
      this.oauthToken = oauthToken;
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
      // Classification falls back to Haiku, NOT `base`: it's a cheap enum-pick we
      // never want to silently run on an expensive general model.
      classification:
        options?.classificationModel ||
        process.env.ANTHROPIC_CLASSIFICATION_MODEL ||
        DEFAULT_CLASSIFICATION_MODEL,
    };
  }

  /** The general-default model, surfaced for status reporting. */
  get model(): string {
    return this.models.default;
  }

  /** Resolve which model to use for a given task (see CompletionOptions.task). */
  modelForTask(task?: LLMTask): string {
    switch (task) {
      case 'word-gloss':
      case 'word-enrichment':
      case 'context-simple':
      case 'context-rich':
        return this.models.word;
      case 'phrase-simple':
      case 'phrase-rich':
        return this.models.phrase;
      case 'chat':
        return this.models.chat;
      case 'word-classification':
        return this.models.classification;
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

  async *stream(options: CompletionOptions): AsyncGenerator<string> {
    const model = this.modelForTask(options.task);
    // The Agent SDK (OAuth path) doesn't expose a clean token stream here, so
    // buffer the whole result and yield it once. The contract only requires the
    // concatenation to equal complete()'s output — pin auth to an API key to get
    // real token-by-token streaming on the latency-critical gloss path.
    if (this.useAgentSdk) {
      const text = await this.completeViaAgentSdk(options, model);
      if (text) yield text;
      return;
    }

    const stream = this.client!.messages.stream({
      model,
      max_tokens: options.maxTokens,
      messages: options.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
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
    if (expectsJson(options) && message.stop_reason === 'max_tokens') {
      throw new LLMTruncatedError(options.maxTokens);
    }
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic');
    }

    return content.text;
  }

  private async completeViaAgentSdk(options: CompletionOptions, model: string): Promise<string> {
    // Build a single prompt from the messages
    const prompt = options.messages.map((m) => m.content).join('\n\n');

    let resultText = '';
    let stopReason: string | null = null;

    for await (const message of query({
      prompt,
      options: {
        model,
        maxTurns: 1,
        systemPrompt: options.messages.find((m) => m.role === 'system')?.content || undefined,
        allowedTools: [],
        permissionMode: 'bypassPermissions',
        // The SDK spawns a Claude Code subprocess that authenticates from its
        // own env (CLAUDE_CODE_OAUTH_TOKEN) — it never sees the token this
        // provider resolved from settings or CLAUDE_OAUTH_TOKEN unless we pass
        // it explicitly. Without this, those sources yield "Not logged in" (#247).
        env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: this.oauthToken },
      },
    })) {
      if (message.type === 'assistant') {
        const content = (
          message as { message?: { content?: Array<{ type: string; text?: string }> } }
        ).message?.content;
        if (content) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              resultText += block.text;
            }
          }
        }
      }
      if (message.type === 'result') {
        const resultMessage = message as { result?: string; stop_reason?: string | null };
        stopReason = resultMessage.stop_reason ?? null;
        const result = resultMessage.result;
        if (result) {
          resultText = result;
        }
      }
    }

    if (expectsJson(options) && stopReason === 'max_tokens') {
      // The Agent SDK does not expose an output-token option, so a retry can
      // regenerate but cannot request a larger cap the way the Messages API can.
      throw new LLMTruncatedError(options.maxTokens, false);
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

  // ── Message Batches (#226): the 50%-off asynchronous tier ─────────────────
  // Only the direct Messages API has a batch endpoint; the Agent-SDK/OAuth path
  // cannot submit batches, so it reports unsupported and callers fall back to
  // synchronous complete().

  supportsBatch(): boolean {
    return !this.useAgentSdk && this.client !== null;
  }

  async createBatch(requests: BatchRequest[]): Promise<string> {
    if (!this.supportsBatch()) {
      throw new Error('Anthropic batches require API-key auth (not OAuth/Agent SDK)');
    }
    const batch = await this.client!.messages.batches.create({
      requests: requests.map((request) => ({
        custom_id: request.customId,
        params: {
          model: this.modelForTask(request.options.task),
          max_tokens: request.options.maxTokens,
          messages: request.options.messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
        },
      })),
    });
    return batch.id;
  }

  async getBatch(batchId: string): Promise<BatchStatus> {
    if (!this.supportsBatch()) {
      throw new Error('Anthropic batches require API-key auth (not OAuth/Agent SDK)');
    }
    let processingStatus: string;
    try {
      processingStatus = (await this.client!.messages.batches.retrieve(batchId)).processing_status;
    } catch (error) {
      // A batch Anthropic no longer knows (deleted, expired out of retention,
      // or created under a different key) can never complete — surface it as
      // terminal so the caller stops polling. Other errors are transient.
      if (error instanceof Anthropic.NotFoundError) {
        return { state: 'failed', error: `batch ${batchId} not found` };
      }
      throw error;
    }
    if (processingStatus !== 'ended') return { state: 'in_progress' };

    const results = new Map<string, string>();
    for await (const entry of await this.client!.messages.batches.results(batchId)) {
      if (entry.result.type !== 'succeeded') continue; // errored/canceled/expired → caller resubmits
      const text = entry.result.message.content.find((block) => block.type === 'text');
      if (text && text.type === 'text') results.set(entry.custom_id, text.text);
    }
    return { state: 'ended', results };
  }
}
