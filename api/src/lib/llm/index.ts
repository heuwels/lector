import type { LLMProvider } from './types';
import { OllamaProvider } from './ollama';
import { AnthropicProvider } from './anthropic';
import { ApfelProvider } from './apfel';
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
  const name = getSetting('llmProvider') || process.env.LLM_PROVIDER || 'anthropic';

  let cacheKey: string;
  switch (name) {
    case 'anthropic': {
      const storedApiKey = getSetting('anthropicApiKey') || undefined;
      const storedOauthToken = getSetting('claudeOauthToken') || undefined;
      const authMode = getSetting('anthropicAuthMode') as string | null;
      const model = process.env.ANTHROPIC_MODEL || undefined;

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
      cacheKey = `anthropic:${effectiveMode}:${model || 'default'}`;
      if (cachedProvider && cachedProviderKey === cacheKey) return cachedProvider;
      cachedProvider = new AnthropicProvider({ apiKey, oauthToken, model });
      break;
    }
    case 'apfel': {
      const model = getSetting('apfelModel') || process.env.APFEL_MODEL || undefined;
      const url = getSetting('apfelUrl') || process.env.APFEL_URL || undefined;
      cacheKey = `apfel:${model || 'default'}:${url || 'default'}`;
      if (cachedProvider && cachedProviderKey === cacheKey) return cachedProvider;
      cachedProvider = new ApfelProvider(url, model);
      break;
    }
    case 'ollama': {
      const model = getSetting('ollamaModel') || process.env.OLLAMA_MODEL || undefined;
      cacheKey = `ollama:${model || 'default'}`;
      if (cachedProvider && cachedProviderKey === cacheKey) return cachedProvider;
      cachedProvider = new OllamaProvider(undefined, model);
      break;
    }
    default: {
      cacheKey = `${name}:default`;
      if (cachedProvider && cachedProviderKey === cacheKey) return cachedProvider;
      cachedProvider = new OllamaProvider();
      break;
    }
  }

  cachedProviderKey = cacheKey;
  return cachedProvider;
}

/** Instantiate all 3 providers independently for parallel comparison */
export function getAllProviders(): Record<string, LLMProvider> {
  const apiKey = getSetting('anthropicApiKey') || undefined;
  const oauthToken = getSetting('claudeOauthToken') || undefined;
  const anthropicModel = process.env.ANTHROPIC_MODEL || undefined;

  const apfelModel = getSetting('apfelModel') || process.env.APFEL_MODEL || undefined;
  const apfelUrl = getSetting('apfelUrl') || process.env.APFEL_URL || undefined;

  const ollamaModel = getSetting('ollamaModel') || process.env.OLLAMA_MODEL || undefined;

  return {
    claude: new AnthropicProvider({ apiKey, oauthToken, model: anthropicModel }),
    apfel: new ApfelProvider(apfelUrl, apfelModel),
    ollama: new OllamaProvider(undefined, ollamaModel),
  };
}

/** Clear cached provider (e.g. when settings change) */
export function resetProvider(): void {
  cachedProvider = null;
  cachedProviderKey = null;
}
