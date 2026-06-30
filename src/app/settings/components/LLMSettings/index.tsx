import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { deleteSetting, getSetting, setSetting } from '@/lib/data-layer';
import { apiFetch } from '@/lib/api-base';
import { Button } from '@/components/ui/button';
import { LLMProvider, LLMStatus, OpenAIPreset } from './types';
import { toast } from 'sonner';

// Presets are pure UI convenience — they autofill the endpoint and nothing else.
// The backend only ever sees one OpenAI-compatible provider (endpoint + key + model).
const PRESET_ENDPOINTS: Record<Exclude<OpenAIPreset, 'custom'>, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
};

export default function LLMSettings() {
  const [llmProvider, setLlmProvider] = useState<LLMProvider>('openai');

  // OpenAI-compatible (Ollama / LM Studio / Apfel / vLLM / …) — one shared config
  const [openaiPreset, setOpenaiPreset] = useState<OpenAIPreset>('custom');
  const [openaiUrl, setOpenaiUrl] = useState('');
  const [openaiModel, setOpenaiModel] = useState('');
  const [openaiModels, setOpenaiModels] = useState<string[]>([]);
  const [openaiFetchingModels, setOpenaiFetchingModels] = useState(false);
  const [openaiFetchError, setOpenaiFetchError] = useState<string | null>(null);
  const [hasOpenaiApiKey, setHasOpenaiApiKey] = useState(false);
  const [newOpenaiApiKey, setNewOpenaiApiKey] = useState('');
  const [editingOpenaiApiKey, setEditingOpenaiApiKey] = useState(false);
  const openaiAutoFetchedForUrl = useRef<string | null>(null);

  // Anthropic (cloud) — unchanged
  const [hasApiKey, setHasApiKey] = useState(false);
  const [hasOauthToken, setHasOauthToken] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [newOauthToken, setNewOauthToken] = useState('');
  const [editingApiKey, setEditingApiKey] = useState(false);
  const [editingOauthToken, setEditingOauthToken] = useState(false);
  const [anthropicAuthMode, setAnthropicAuthMode] = useState<'api_key' | 'oauth'>('api_key');

  const [isFetchingLlmStatus, setIsFetchingLlmStatus] = useState(false);
  const [llmStatus, setLlmStatus] = useState<LLMStatus | null>(null);

  useEffect(() => {
    // Load LLM provider settings from server. Any legacy local provider
    // (ollama / apfel / lmstudio) is normalized to the unified 'openai' panel —
    // the server-side migration carries their old config across.
    getSetting<string>('llmProvider').then((p) => {
      setLlmProvider(p === 'anthropic' ? 'anthropic' : 'openai');
    });
    getSetting<string>('openaiPreset').then((p) => {
      if (p === 'custom' || p === 'ollama' || p === 'lmstudio') setOpenaiPreset(p);
    });
    getSetting<string>('openaiUrl').then((u) => {
      if (u) setOpenaiUrl(u);
    });
    getSetting<string>('openaiModel').then((m) => {
      if (m) setOpenaiModel(m);
    });
    getSetting<boolean>('openaiApiKey').then((v) => {
      setHasOpenaiApiKey(v === true);
    });
    getSetting<boolean>('anthropicApiKey').then((v) => {
      setHasApiKey(v === true);
    });
    getSetting<boolean>('claudeOauthToken').then((v) => {
      setHasOauthToken(v === true);
    });
    getSetting<string>('anthropicAuthMode').then((m) => {
      if (m === 'api_key' || m === 'oauth') setAnthropicAuthMode(m);
    });

    primeLlmStatus();
  }, []);

  // Auto-fetch models when the user lands on Settings with an OpenAI-compatible
  // endpoint configured but the in-memory list is empty (e.g. on a page refresh —
  // we don't persist the fetched list, only the selected model id). Tracks the
  // last URL we fetched for to avoid refetching after a fetch returns empty.
  useEffect(() => {
    if (llmProvider !== 'openai') return;
    if (!openaiUrl) return;
    if (openaiFetchingModels) return;
    if (openaiModels.length > 0) return;
    if (openaiAutoFetchedForUrl.current === openaiUrl) return;
    openaiAutoFetchedForUrl.current = openaiUrl;
    fetchOpenaiModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchOpenaiModels is stable for our purposes; including it would cause re-runs on every render
  }, [llmProvider, openaiUrl, openaiFetchingModels, openaiModels.length]);

  const primeLlmStatus = async () => {
    setIsFetchingLlmStatus(true);

    try {
      const req = await apiFetch('/api/llm-status');
      const res = await req.json();

      setLlmStatus(res);
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch LLM Status');
    } finally {
      setIsFetchingLlmStatus(false);
    }
  };

  // Save LLM provider setting
  const saveLLMProvider = async (provider: LLMProvider) => {
    setLlmProvider(provider);
    await setSetting('llmProvider', provider);
    // Reset the cached provider on the server
    await apiFetch('/api/llm-status/reset', { method: 'POST' });
    // Refresh status
    await primeLlmStatus();
  };

  // Whenever endpoint or apiKey changes, the previously-selected model may not
  // exist on the new endpoint and any prior fetch is stale. Clear them so the
  // user re-fetches and re-selects.
  const resetOpenaiModelSelection = async () => {
    setOpenaiModel('');
    setOpenaiModels([]);
    setOpenaiFetchError(null);
    openaiAutoFetchedForUrl.current = null;
    await setSetting('openaiModel', '');
  };

  const persistOpenaiUrl = async (url: string) => {
    setOpenaiUrl(url);
    await setSetting('openaiUrl', url);
    await resetOpenaiModelSelection();
    await apiFetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const saveOpenaiPreset = async (preset: OpenAIPreset) => {
    setOpenaiPreset(preset);
    await setSetting('openaiPreset', preset);
    if (preset !== 'custom') {
      await persistOpenaiUrl(PRESET_ENDPOINTS[preset]);
    }
  };

  const saveOpenaiUrl = async (url: string) => {
    // Manual edits mean "custom" — the preset no longer describes the endpoint.
    if (openaiPreset !== 'custom') {
      setOpenaiPreset('custom');
      await setSetting('openaiPreset', 'custom');
    }
    await persistOpenaiUrl(url);
  };

  const saveOpenaiModel = async (model: string) => {
    setOpenaiModel(model);
    await setSetting('openaiModel', model);
    await apiFetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const saveOpenaiApiKey = async (key: string) => {
    if (!key.trim()) return;
    await setSetting('openaiApiKey', key);
    setHasOpenaiApiKey(true);
    setNewOpenaiApiKey('');
    setEditingOpenaiApiKey(false);
    await resetOpenaiModelSelection();
    await apiFetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const clearOpenaiApiKey = async () => {
    await deleteSetting('openaiApiKey');
    setHasOpenaiApiKey(false);
    setNewOpenaiApiKey('');
    setEditingOpenaiApiKey(false);
    await resetOpenaiModelSelection();
    await apiFetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const fetchOpenaiModels = async () => {
    setOpenaiFetchingModels(true);
    setOpenaiFetchError(null);
    try {
      // The server reads the saved API key from settings — never sent from the browser.
      const res = await apiFetch('/api/llm/openai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: openaiUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOpenaiFetchError(data?.error || `Status ${res.status}`);
        setOpenaiModels([]);
      } else {
        const list: string[] = Array.isArray(data?.models) ? data.models : [];
        setOpenaiModels(list);
        if (list.length === 0) {
          setOpenaiFetchError('No models reported by this endpoint — type the model name instead.');
        }
      }
    } catch (err) {
      setOpenaiFetchError(err instanceof Error ? err.message : 'Failed to fetch models');
      setOpenaiModels([]);
    } finally {
      setOpenaiFetchingModels(false);
    }
  };

  const saveAnthropicApiKey = async (key: string) => {
    await setSetting('anthropicApiKey', key);
    setHasApiKey(true);
    setNewApiKey('');
    setEditingApiKey(false);
    await apiFetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const clearAnthropicApiKey = async () => {
    await deleteSetting('anthropicApiKey');
    setHasApiKey(false);
    await apiFetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const saveClaudeOauthToken = async (token: string) => {
    await setSetting('claudeOauthToken', token);
    setHasOauthToken(true);
    setNewOauthToken('');
    setEditingOauthToken(false);
    await apiFetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const clearClaudeOauthToken = async () => {
    await deleteSetting('claudeOauthToken');
    setHasOauthToken(false);
    await apiFetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const saveAnthropicAuthMode = async (mode: 'api_key' | 'oauth') => {
    setAnthropicAuthMode(mode);
    await setSetting('anthropicAuthMode', mode);
    await apiFetch('/api/llm-status/reset', { method: 'POST' });
    setIsFetchingLlmStatus(true);
    try {
      const res = await apiFetch('/api/llm-status/test', { method: 'POST' });
      const data = await res.json();
      setLlmStatus((prev) =>
        prev
          ? { ...prev, ok: data.ok, error: data.error }
          : { provider: llmProvider, model: openaiModel, ok: data.ok, error: data.error },
      );
    } catch {
      setLlmStatus((prev) =>
        prev ? { ...prev, ok: false, error: 'Failed to reach server' } : null,
      );
    } finally {
      setIsFetchingLlmStatus(false);
    }
  };

  const testLLMConnection = async () => {
    setIsFetchingLlmStatus(true);
    try {
      const res = await apiFetch('/api/llm-status/test', { method: 'POST' });
      const data = await res.json();
      setLlmStatus((prev) =>
        prev
          ? { ...prev, ok: data.ok, error: data.error }
          : { provider: llmProvider, model: openaiModel, ok: data.ok, error: data.error },
      );
    } catch {
      setLlmStatus((prev) =>
        prev ? { ...prev, ok: false, error: 'Failed to reach server' } : null,
      );
    } finally {
      setIsFetchingLlmStatus(false);
    }
  };

  return (
    <section className="panel p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">AI Provider</h2>
        <div className="flex items-center gap-2">
          <span
            className={clsx(`inline-block h-2 w-2 rounded-full`, {
              'bg-primary': llmStatus?.ok,
              'bg-destructive': !llmStatus?.ok,
              'bg-yellow-500': isFetchingLlmStatus,
            })}
          />
          <span className="text-sm text-muted-foreground">
            {llmStatus?.ok ? 'Connected' : llmStatus?.error || 'Not connected'}
            <Button variant="link" onClick={testLLMConnection} disabled={isFetchingLlmStatus}>
              {isFetchingLlmStatus ? 'Checking...' : 'Refresh'}
            </Button>
          </span>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Choose how translations are powered. Anthropic uses cloud AI for the highest quality.
        Local &amp; self-hosted covers any OpenAI-compatible server — Ollama, LM Studio, Apfel, vLLM,
        and friends — with one endpoint, an optional API key, and a model name.
      </p>

      {/* Provider selector */}
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-foreground">
          Provider
        </label>
        <select
          value={llmProvider}
          onChange={(e) => saveLLMProvider(e.target.value as LLMProvider)}
          data-testid="llm-provider"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none "
        >
          <option value="anthropic">Anthropic (cloud)</option>
          <option value="openai">Local / self-hosted (OpenAI-compatible)</option>
        </select>
      </div>

      {/* Anthropic settings */}
      {llmProvider === 'anthropic' && (
        <div className="mb-4 space-y-4">
          {/* Auth mode toggle — only when both credentials are configured */}
          {hasApiKey && hasOauthToken && (
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Authentication Method
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => saveAnthropicAuthMode('api_key')}
                  disabled={isFetchingLlmStatus}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    anthropicAuthMode === 'api_key'
                      ? 'border-primary bg-[var(--primary-soft)] text-primary'
                      : 'border-border bg-card text-foreground hover:bg-accent'
                  }`}
                >
                  API Key
                </button>
                <button
                  onClick={() => saveAnthropicAuthMode('oauth')}
                  disabled={isFetchingLlmStatus}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    anthropicAuthMode === 'oauth'
                      ? 'border-primary bg-[var(--primary-soft)] text-primary'
                      : 'border-border bg-card text-foreground hover:bg-accent'
                  }`}
                >
                  OAuth Token
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Both credentials are configured. Choose which to use — connection will be tested
                automatically.
              </p>
            </div>
          )}

          {/* API Key */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              API Key
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              Get your API key from{' '}
              <a
                href="https://console.anthropic.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                console.anthropic.com
              </a>
            </p>
            {hasApiKey && !editingApiKey ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary-soft)] px-3 py-2 text-sm font-medium text-primary ">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                  Configured
                </span>
                <button
                  onClick={() => setEditingApiKey(true)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
                >
                  Replace
                </button>
                <button
                  onClick={clearAnthropicApiKey}
                  className="rounded-md border border-destructive/40 bg-background px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="sk-ant-api..."
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none  "
                />
                <button
                  onClick={() => saveAnthropicApiKey(newApiKey)}
                  disabled={!newApiKey.trim()}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>
                {editingApiKey && (
                  <button
                    onClick={() => {
                      setEditingApiKey(false);
                      setNewApiKey('');
                    }}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-border" />
            <span className="mx-3 flex-shrink text-xs text-muted-foreground">or</span>
            <div className="flex-grow border-t border-border" />
          </div>

          {/* OAuth Token */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              OAuth Token <span className="font-normal text-muted-foreground">(Pro/Team plan)</span>
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              Uses your Claude Pro or Team subscription credits. Run{' '}
              <code className="rounded bg-muted px-1">claude setup-token</code>{' '}
              to obtain a token. Note: slower initial startup than API keys.
            </p>
            {hasOauthToken && !editingOauthToken ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary-soft)] px-3 py-2 text-sm font-medium text-primary ">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                  Configured
                </span>
                <button
                  onClick={() => setEditingOauthToken(true)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
                >
                  Replace
                </button>
                <button
                  onClick={clearClaudeOauthToken}
                  className="rounded-md border border-destructive/40 bg-background px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newOauthToken}
                  onChange={(e) => setNewOauthToken(e.target.value)}
                  placeholder="sk-ant-oat01-..."
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none  "
                />
                <button
                  onClick={() => saveClaudeOauthToken(newOauthToken)}
                  disabled={!newOauthToken.trim()}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>
                {editingOauthToken && (
                  <button
                    onClick={() => {
                      setEditingOauthToken(false);
                      setNewOauthToken('');
                    }}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* OpenAI-compatible settings (Ollama / LM Studio / Apfel / vLLM / …) */}
      {llmProvider === 'openai' && (
        <div className="mb-4 space-y-4" data-testid="openai-settings">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Preset
            </label>
            <select
              value={openaiPreset}
              onChange={(e) => saveOpenaiPreset(e.target.value as OpenAIPreset)}
              data-testid="openai-preset"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none "
            >
              <option value="custom">Custom / other OpenAI-compatible server</option>
              <option value="ollama">Ollama (localhost:11434)</option>
              <option value="lmstudio">LM Studio (localhost:1234)</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              A shortcut that fills in the endpoint below. You can edit it afterwards.
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Endpoint
            </label>
            <input
              type="text"
              value={openaiUrl}
              onChange={(e) => saveOpenaiUrl(e.target.value)}
              placeholder="http://localhost:11434"
              data-testid="openai-endpoint"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none  "
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Base URL of your server — the app appends <code className="rounded bg-muted px-1">/v1</code>.
              It&apos;s called server-side, so localhost works even when lector is hosted elsewhere.
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              API Key (optional)
            </label>
            {hasOpenaiApiKey && !editingOpenaiApiKey ? (
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex items-center rounded-md bg-[var(--primary-soft)] px-2 py-1 text-xs font-medium text-primary "
                  data-testid="openai-api-key-status"
                >
                  Configured
                </span>
                <button
                  type="button"
                  onClick={() => setEditingOpenaiApiKey(true)}
                  className="rounded-md border border-input bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-accent"
                  data-testid="openai-api-key-replace"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={clearOpenaiApiKey}
                  className="rounded-md border border-destructive/40 bg-background px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                  data-testid="openai-api-key-clear"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newOpenaiApiKey}
                  onChange={(e) => setNewOpenaiApiKey(e.target.value)}
                  placeholder="leave empty for local servers without auth"
                  data-testid="openai-api-key"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none  "
                />
                <button
                  type="button"
                  onClick={() => saveOpenaiApiKey(newOpenaiApiKey)}
                  disabled={!newOpenaiApiKey.trim()}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  data-testid="openai-api-key-save"
                >
                  Save
                </button>
                {editingOpenaiApiKey && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingOpenaiApiKey(false);
                      setNewOpenaiApiKey('');
                    }}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Sent as a Bearer token from the server (never exposed to the browser after save). Only
              needed for reverse-proxied, cloud, or otherwise authenticated endpoints.
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Model
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                list="openai-model-options"
                value={openaiModel}
                onChange={(e) => saveOpenaiModel(e.target.value)}
                placeholder={openaiFetchingModels ? 'Fetching models…' : 'Type a model name, or fetch the list'}
                data-testid="openai-model"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none "
              />
              <datalist id="openai-model-options">
                {openaiModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <button
                type="button"
                onClick={fetchOpenaiModels}
                disabled={openaiFetchingModels || !openaiUrl}
                data-testid="openai-fetch-models"
                className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                {openaiFetchingModels ? 'Fetching...' : 'Fetch models'}
              </button>
            </div>
            {openaiFetchError && (
              <p
                className="mt-1 text-xs text-destructive"
                data-testid="openai-fetch-error"
              >
                {openaiFetchError}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Pick from the fetched list (servers like LM Studio &amp; Ollama report it via{' '}
              <code className="rounded bg-muted px-1">/v1/models</code>) or just type any model name
              your server accepts.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
