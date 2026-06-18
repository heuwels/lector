import type { LLMProvider } from './types';
import { AnthropicProvider } from './anthropic';
import { OpenAICompatibleProvider } from './openai-compatible';
import { db } from '../../db';

export type { LLMProvider, ChatMessage, CompletionOptions } from './types';

let cachedProvider: LLMProvider | null = null;
let cachedProviderKey: string | null = null;

function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function getProvider(): LLMProvider {
  const raw = getSetting('llmProvider') || process.env.LLM_PROVIDER || 'anthropic';
  // 'ollama' / 'apfel' / 'lmstudio' were separate providers; they are now one
  // OpenAI-compatible backend. Map any legacy or unknown value onto it.
  const name = raw === 'anthropic' ? 'anthropic' : 'openai';

  let cacheKey: string;
  if (name === 'anthropic') {
    const storedApiKey = getSetting('anthropicApiKey') || undefined;
    const storedOauthToken = getSetting('claudeOauthToken') || undefined;
    const authMode = getSetting('anthropicAuthMode') as string | null;
    const model = process.env.ANTHROPIC_MODEL || undefined;
    const wordModel = process.env.ANTHROPIC_WORD_MODEL || undefined;
    const phraseModel = process.env.ANTHROPIC_PHRASE_MODEL || undefined;
    const chatModel = process.env.ANTHROPIC_CHAT_MODEL || undefined;

    // Respect explicit auth mode; fall back to whichever credential is set
    let apiKey: string | undefined;
    let oauthToken: string | undefined;
    if (authMode === 'oauth') {
      oauthToken = storedOauthToken;
    } else if (authMode === 'api_key') {
      apiKey = storedApiKey;
    } else {
      apiKey = storedApiKey;
      oauthToken = storedApiKey ? undefined : storedOauthToken;
    }

    const effectiveMode = apiKey ? 'key' : oauthToken ? 'oauth' : 'env';
    cacheKey = `anthropic:${effectiveMode}:${model || 'default'}:${wordModel || 'd'}:${phraseModel || 'd'}:${chatModel || 'd'}`;
    if (cachedProvider && cachedProviderKey === cacheKey) return cachedProvider;
    cachedProvider = new AnthropicProvider({ apiKey, oauthToken, model, wordModel, phraseModel, chatModel });
  } else {
    // Settings take precedence; env vars are the fallback. The legacy
    // OLLAMA_*/APFEL_*/LMSTUDIO_* vars are still read so existing env-configured
    // deployments keep working without edits (a given deploy only sets one set).
    const url =
      getSetting('openaiUrl') ||
      process.env.OPENAI_COMPAT_URL ||
      process.env.OLLAMA_URL ||
      process.env.APFEL_URL ||
      process.env.LMSTUDIO_URL ||
      undefined;
    const model =
      getSetting('openaiModel') ||
      process.env.OPENAI_COMPAT_MODEL ||
      process.env.OLLAMA_MODEL ||
      process.env.APFEL_MODEL ||
      process.env.LMSTUDIO_MODEL ||
      undefined;
    const apiKey =
      getSetting('openaiApiKey') ||
      process.env.OPENAI_COMPAT_API_KEY ||
      process.env.LMSTUDIO_API_KEY ||
      undefined;

    cacheKey = `openai:${url || 'default'}:${model || 'default'}:${apiKey ? 'keyed' : 'open'}`;
    if (cachedProvider && cachedProviderKey === cacheKey) return cachedProvider;
    cachedProvider = new OpenAICompatibleProvider({ baseUrl: url, model, apiKey });
  }

  cachedProviderKey = cacheKey;
  return cachedProvider;
}

/** Clear cached provider (e.g. when settings change) */
export function resetProvider(): void {
  cachedProvider = null;
  cachedProviderKey = null;
}
