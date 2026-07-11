import type { LLMProvider, LLMTask } from './types';
import { AnthropicProvider } from './anthropic';
import { OpenAICompatibleProvider } from './openai-compatible';
import { db } from '../../db';
import { LOCAL_USER_ID } from '../user';
import { getByokCredential, OPENROUTER_URL } from '../byok';

export type { LLMProvider, LLMTask, ChatMessage, CompletionOptions, LLMUsageEvent } from './types';
export { parseLooseJson } from './parse-json';
export { completeJson } from './complete-json';
export { LLMInvalidJsonError } from './errors';

let cachedProvider: LLMProvider | null = null;
let cachedProviderKey: string | null = null;

export const MANAGED_TRANSLATION_MODEL = 'google/gemini-2.5-flash-lite';

function requestProfile(baseUrl: string | undefined): 'openrouter' | undefined {
  return baseUrl?.replace(/\/$/, '') === OPENROUTER_URL ? 'openrouter' : undefined;
}

// Deliberately the LOCAL user's settings, not the requester's (#220): the
// provider is one process-global cached instance. Hosted Free is the exception:
// its managed provider is a cost boundary, so stale pre-cloud LOCAL settings
// must never override the boot-validated env URL, key, or task-model pins.
// Explicit per-user BYOK returns before this path and remains unaffected.
function getSetting(key: string): string | null {
  const row = db
    .prepare('SELECT value FROM settings WHERE userId = ? AND key = ?')
    .get(LOCAL_USER_ID, key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function hostedFreeUsesDeploymentConfig(): boolean {
  return process.env.LECTOR_MODE === 'cloud' && process.env.LECTOR_FREE_TIER === 'true';
}

export interface ProviderAccessOptions {
  /** Entitlement decision made for this exact operation/reservation. */
  byok: boolean;
}

export class ByokCredentialUnavailableError extends Error {
  constructor() {
    super('BYOK credential is no longer available');
    this.name = 'ByokCredentialUnavailableError';
  }
}

export function getProvider(): LLMProvider;
export function getProvider(userId: string, access: ProviderAccessOptions): LLMProvider;
export function getProvider(
  userId: string = LOCAL_USER_ID,
  access?: ProviderAccessOptions,
): LLMProvider {
  // The no-argument overload is the implicit local/self-hosted path and keeps
  // its historical "use the local key if present" behavior. Every explicit
  // user call must carry the entitlement decision: true never falls back to a
  // managed key after concurrent removal; false ignores a concurrently-added
  // key so a managed reservation cannot switch billing source mid-request.
  const implicitLocal = arguments.length === 0;
  if (!implicitLocal && !access) {
    throw new Error('Explicit user provider access requires an expected BYOK mode');
  }
  const requireByok = implicitLocal ? true : access!.byok;
  const byok = requireByok ? getByokCredential(userId) : null;
  if (requireByok && !implicitLocal && !byok) throw new ByokCredentialUnavailableError();
  if (byok) {
    // Never put user credentials in the process-global provider cache: an
    // account-specific instance prevents cross-tenant key/model bleed.
    if (byok.provider === 'anthropic') {
      return new AnthropicProvider({ apiKey: byok.apiKey, model: byok.model });
    }
    return new OpenAICompatibleProvider({
      baseUrl: OPENROUTER_URL,
      apiKey: byok.apiKey,
      model: byok.model,
      profile: requestProfile(OPENROUTER_URL),
    });
  }
  const deploymentOnly = hostedFreeUsesDeploymentConfig();
  const providerSetting = (key: string) => (deploymentOnly ? null : getSetting(key));
  const raw = providerSetting('llmProvider') || process.env.LLM_PROVIDER || 'anthropic';
  // 'ollama' / 'apfel' / 'lmstudio' were separate providers; they are now one
  // OpenAI-compatible backend. Map any legacy or unknown value onto it.
  const name = raw === 'anthropic' ? 'anthropic' : 'openai';

  let cacheKey: string;
  if (name === 'anthropic') {
    const storedApiKey = providerSetting('anthropicApiKey') || undefined;
    const storedOauthToken = providerSetting('claudeOauthToken') || undefined;
    const authMode = providerSetting('anthropicAuthMode') as string | null;
    const model = process.env.ANTHROPIC_MODEL || undefined;
    const wordModel = process.env.ANTHROPIC_WORD_MODEL || undefined;
    const phraseModel = process.env.ANTHROPIC_PHRASE_MODEL || undefined;
    const chatModel = process.env.ANTHROPIC_CHAT_MODEL || undefined;
    const classificationModel = process.env.ANTHROPIC_CLASSIFICATION_MODEL || undefined;

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
    cacheKey = `anthropic:${deploymentOnly ? 'deployment' : 'settings'}:${effectiveMode}:${model || 'default'}:${wordModel || 'd'}:${phraseModel || 'd'}:${chatModel || 'd'}:${classificationModel || 'd'}`;
    if (cachedProvider && cachedProviderKey === cacheKey) return cachedProvider;
    cachedProvider = new AnthropicProvider({
      apiKey,
      oauthToken,
      model,
      wordModel,
      phraseModel,
      chatModel,
      classificationModel,
    });
  } else {
    // Settings take precedence; env vars are the fallback. The legacy
    // OLLAMA_*/APFEL_*/LMSTUDIO_* vars are still read so existing env-configured
    // deployments keep working without edits (a given deploy only sets one set).
    const storedUrl = providerSetting('openaiUrl');
    const storedModel = providerSetting('openaiModel');
    const storedApiKey = providerSetting('openaiApiKey');
    const url =
      storedUrl ||
      process.env.OPENAI_COMPAT_URL ||
      process.env.OLLAMA_URL ||
      process.env.APFEL_URL ||
      process.env.LMSTUDIO_URL ||
      undefined;
    const model =
      storedModel ||
      process.env.OPENAI_COMPAT_MODEL ||
      process.env.OLLAMA_MODEL ||
      process.env.APFEL_MODEL ||
      process.env.LMSTUDIO_MODEL ||
      undefined;
    const apiKey =
      storedApiKey ||
      process.env.OPENAI_COMPAT_API_KEY ||
      process.env.LMSTUDIO_API_KEY ||
      undefined;

    const profile = requestProfile(url);
    const deploymentManaged = deploymentOnly || (!storedUrl && !storedModel && !storedApiKey);
    const taskModels: Partial<Record<LLMTask, string>> =
      deploymentManaged && profile === 'openrouter'
        ? {
            'word-gloss': process.env.OPENAI_COMPAT_WORD_GLOSS_MODEL || MANAGED_TRANSLATION_MODEL,
            'phrase-simple':
              process.env.OPENAI_COMPAT_SIMPLE_PHRASE_MODEL || MANAGED_TRANSLATION_MODEL,
            'context-simple':
              process.env.OPENAI_COMPAT_SIMPLE_CONTEXT_MODEL || MANAGED_TRANSLATION_MODEL,
          }
        : {};
    const taskModelKey = Object.entries(taskModels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([task, taskModel]) => `${task}=${taskModel}`)
      .join(',');

    cacheKey = `openai:${deploymentOnly ? 'deployment' : 'settings'}:${url || 'default'}:${model || 'default'}:${apiKey ? 'keyed' : 'open'}:${taskModelKey || 'no-task-models'}`;
    if (cachedProvider && cachedProviderKey === cacheKey) return cachedProvider;
    cachedProvider = new OpenAICompatibleProvider({
      baseUrl: url,
      model,
      apiKey,
      profile,
      taskModels,
    });
  }

  cachedProviderKey = cacheKey;
  return cachedProvider;
}

/** Clear cached provider (e.g. when settings change) */
export function resetProvider(): void {
  cachedProvider = null;
  cachedProviderKey = null;
}

/**
 * Provider for the background word→domain classifier. Classification is high
 * volume, latency-insensitive, and only ever picks one enum value per word — an
 * ideal job for a cheap local model.
 *
 * Set `CLASSIFY_LLM_URL` (and optionally `CLASSIFY_LLM_MODEL` / `CLASSIFY_LLM_API_KEY`)
 * to point classification at a dedicated OpenAI-compatible endpoint — e.g. a
 * local LM Studio model — so it runs free and offline and never competes with
 * interactive translation. When unset, classification uses the app's main
 * provider: Anthropic resolves the cheap `ANTHROPIC_CLASSIFICATION_MODEL` (Haiku)
 * via the `word-classification` task hint, and an all-LM-Studio / Ollama install
 * classifies on its one configured model. So existing setups are unchanged, and
 * pointing classification at LM Studio is a config change, not a code change.
 */
export function getClassificationProvider(): LLMProvider {
  const baseUrl = process.env.CLASSIFY_LLM_URL;
  const model = process.env.CLASSIFY_LLM_MODEL;
  if (baseUrl || model) {
    return new OpenAICompatibleProvider({
      baseUrl,
      model,
      apiKey: process.env.CLASSIFY_LLM_API_KEY,
      profile: requestProfile(baseUrl),
    });
  }
  return getProvider();
}
