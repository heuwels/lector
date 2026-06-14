import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { deleteSetting, getSetting, setSetting } from '@/lib/data-layer';
import { Button } from '@/components/ui/button';
import { OLLAMA_MODELS } from './constants';
import { LLMProvider, LLMStatus, LMStudioLoadStatus } from './types';

export default function LLMSettings() {
  const [llmProvider, setLlmProvider] = useState<LLMProvider>('ollama');
  const [ollamaModel, setOllamaModel] = useState('llama3.1:8b');
  const [apfelUrl, setApfelUrl] = useState('http://localhost:11434');
  const [apfelModel, setApfelModel] = useState('default');
  const [lmstudioUrl, setLmstudioUrl] = useState('http://localhost:1234');
  const [hasLmstudioApiKey, setHasLmstudioApiKey] = useState(false);
  const [newLmstudioApiKey, setNewLmstudioApiKey] = useState('');
  const [editingLmstudioApiKey, setEditingLmstudioApiKey] = useState(false);
  const [lmstudioModel, setLmstudioModel] = useState('');
  const [lmstudioModels, setLmstudioModels] = useState<string[]>([]);
  const [lmstudioFetchingModels, setLmstudioFetchingModels] = useState(false);
  const [lmstudioFetchError, setLmstudioFetchError] = useState<string | null>(null);
  const [lmstudioLoadStatus, setLmstudioLoadStatus] = useState<LMStudioLoadStatus>('idle');
  const [lmstudioLoadError, setLmstudioLoadError] = useState<string | null>(null);
  const lmstudioAutoFetchedForUrl = useRef<string | null>(null);
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
    // Load LLM provider settings from server
    getSetting<string>('llmProvider').then((p) => {
      if (p === 'ollama' || p === 'anthropic' || p === 'apfel' || p === 'lmstudio')
        setLlmProvider(p);
    });
    getSetting<string>('ollamaModel').then((m) => {
      if (m) setOllamaModel(m);
    });
    getSetting<string>('apfelUrl').then((u) => {
      if (u) setApfelUrl(u);
    });
    getSetting<string>('apfelModel').then((m) => {
      if (m) setApfelModel(m);
    });
    getSetting<string>('lmstudioUrl').then((u) => {
      if (u) setLmstudioUrl(u);
    });
    getSetting<boolean>('lmstudioApiKey').then((v) => {
      setHasLmstudioApiKey(v === true);
    });
    getSetting<string>('lmstudioModel').then((m) => {
      if (m) setLmstudioModel(m);
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

  // Auto-fetch LM Studio models when the user lands on Settings with LM Studio
  // configured but the in-memory list is empty (e.g. on a page refresh — we
  // don't persist the fetched list, only the selected model id). Tracks the
  // last URL we fetched for to avoid refetching after a fetch returns empty.
  useEffect(() => {
    if (llmProvider !== 'lmstudio') return;
    if (!lmstudioUrl) return;
    if (lmstudioFetchingModels) return;
    if (lmstudioModels.length > 0) return;
    if (lmstudioAutoFetchedForUrl.current === lmstudioUrl) return;
    lmstudioAutoFetchedForUrl.current = lmstudioUrl;
    fetchLmstudioModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchLmstudioModels is stable for our purposes; including it would cause re-runs on every render
  }, [llmProvider, lmstudioUrl, lmstudioFetchingModels, lmstudioModels.length]);

  const primeLlmStatus = async () => {
    setIsFetchingLlmStatus(true);

    try {
      const req = await fetch('/api/llm-status');
      const res = await req.json();

      setLlmStatus(res);
    } catch (_) {
    } finally {
      setIsFetchingLlmStatus(false);
    }
  };

  // Save LLM provider setting
  const saveLLMProvider = async (provider: LLMProvider) => {
    setLlmProvider(provider);
    await setSetting('llmProvider', provider);
    // Reset the cached provider on the server
    await fetch('/api/llm-status/reset', { method: 'POST' });
    // Refresh status
    await primeLlmStatus();
  };

  const saveOllamaModel = async (model: string) => {
    setOllamaModel(model);
    await setSetting('ollamaModel', model);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const saveApfelUrl = async (url: string) => {
    setApfelUrl(url);
    await setSetting('apfelUrl', url);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const saveApfelModel = async (model: string) => {
    setApfelModel(model);
    await setSetting('apfelModel', model);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  // Whenever endpoint or apiKey changes, the previously-selected model may not exist
  // on the new endpoint and any prior load status is stale. Clear them so the user
  // re-fetches and re-loads. We don't auto-fetch models — the user owns that action.
  const resetLmstudioModelSelection = async () => {
    setLmstudioModel('');
    setLmstudioModels([]);
    setLmstudioFetchError(null);
    setLmstudioLoadStatus('idle');
    setLmstudioLoadError(null);
    await setSetting('lmstudioModel', '');
  };

  const saveLmstudioUrl = async (url: string) => {
    setLmstudioUrl(url);
    await setSetting('lmstudioUrl', url);
    await resetLmstudioModelSelection();
    await fetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const saveLmstudioApiKey = async (key: string) => {
    if (!key.trim()) return;
    await setSetting('lmstudioApiKey', key);
    setHasLmstudioApiKey(true);
    setNewLmstudioApiKey('');
    setEditingLmstudioApiKey(false);
    await resetLmstudioModelSelection();
    await fetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const clearLmstudioApiKey = async () => {
    await deleteSetting('lmstudioApiKey');
    setHasLmstudioApiKey(false);
    setNewLmstudioApiKey('');
    setEditingLmstudioApiKey(false);
    await resetLmstudioModelSelection();
    await fetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const saveLmstudioModel = async (model: string) => {
    setLmstudioModel(model);
    await setSetting('lmstudioModel', model);
    setLmstudioLoadStatus('idle');
    setLmstudioLoadError(null);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const fetchLmstudioModels = async () => {
    setLmstudioFetchingModels(true);
    setLmstudioFetchError(null);
    try {
      // The server reads the saved API key from settings — never sent from the browser.
      const res = await fetch('/api/llm/lmstudio/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: lmstudioUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLmstudioFetchError(data?.error || `Status ${res.status}`);
        setLmstudioModels([]);
      } else {
        const list: string[] = Array.isArray(data?.models) ? data.models : [];
        setLmstudioModels(list);
        if (list.length === 0) {
          setLmstudioFetchError('No models reported by this endpoint');
        }
      }
    } catch (err) {
      setLmstudioFetchError(err instanceof Error ? err.message : 'Failed to fetch models');
      setLmstudioModels([]);
    } finally {
      setLmstudioFetchingModels(false);
    }
  };

  const loadLmstudioModel = async () => {
    if (!lmstudioModel) return;
    setLmstudioLoadStatus('loading');
    setLmstudioLoadError(null);
    try {
      const res = await fetch('/api/llm/lmstudio/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: lmstudioUrl,
          model: lmstudioModel,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setLmstudioLoadStatus('errored');
        setLmstudioLoadError(data?.error || `Status ${res.status}`);
      } else {
        setLmstudioLoadStatus('loaded');
      }
    } catch (err) {
      setLmstudioLoadStatus('errored');
      setLmstudioLoadError(err instanceof Error ? err.message : 'Load failed');
    }
  };

  const saveAnthropicApiKey = async (key: string) => {
    await setSetting('anthropicApiKey', key);
    setHasApiKey(true);
    setNewApiKey('');
    setEditingApiKey(false);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const clearAnthropicApiKey = async () => {
    await deleteSetting('anthropicApiKey');
    setHasApiKey(false);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const saveClaudeOauthToken = async (token: string) => {
    await setSetting('claudeOauthToken', token);
    setHasOauthToken(true);
    setNewOauthToken('');
    setEditingOauthToken(false);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const clearClaudeOauthToken = async () => {
    await deleteSetting('claudeOauthToken');
    setHasOauthToken(false);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    await primeLlmStatus();
  };

  const saveAnthropicAuthMode = async (mode: 'api_key' | 'oauth') => {
    setAnthropicAuthMode(mode);
    await setSetting('anthropicAuthMode', mode);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    setIsFetchingLlmStatus(true);
    try {
      const res = await fetch('/api/llm-status/test', { method: 'POST' });
      const data = await res.json();
      setLlmStatus((prev) =>
        prev
          ? { ...prev, ok: data.ok, error: data.error }
          : { provider: llmProvider, model: ollamaModel, ok: data.ok, error: data.error },
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
      const res = await fetch('/api/llm-status/test', { method: 'POST' });
      const data = await res.json();
      setLlmStatus((prev) =>
        prev
          ? { ...prev, ok: data.ok, error: data.error }
          : { provider: llmProvider, model: ollamaModel, ok: data.ok, error: data.error },
      );
    } catch {
      setLlmStatus((prev) =>
        prev ? { ...prev, ok: false, error: 'Failed to reach server' } : null,
      );
    } finally {
      setIsFetchingLlmStatus(true);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">AI Provider</h2>
        <div className="flex items-center gap-2">
          <span
            className={clsx(`inline-block h-2 w-2 rounded-full`, {
              'bg-green-500': llmStatus?.ok,
              'bg-red-500': !llmStatus?.ok,
              'bg-yellow-500': isFetchingLlmStatus,
            })}
          />
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {llmStatus?.ok ? 'Connected' : llmStatus?.error || 'Not connected'}
            <Button variant="link" onClick={testLLMConnection} disabled={isFetchingLlmStatus}>
              {isFetchingLlmStatus ? 'Checking...' : 'Refresh'}
            </Button>
          </span>
        </div>
      </div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Choose how translations are powered. Ollama runs locally (no API key needed). Anthropic uses
        cloud AI for higher quality. Apfel is an OpenAI-compatible API you can self-host.
      </p>

      {/* Provider selector */}
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Provider
        </label>
        <select
          value={llmProvider}
          onChange={(e) => saveLLMProvider(e.target.value as LLMProvider)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option value="ollama">Ollama (local)</option>
          <option value="anthropic">Anthropic (cloud)</option>
          <option value="apfel">Apfel (self-hosted)</option>
          <option value="lmstudio">LM Studio (local)</option>
        </select>
      </div>

      {/* Ollama settings */}
      {llmProvider === 'ollama' && (
        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Model
          </label>
          <select
            value={ollamaModel}
            onChange={(e) => saveOllamaModel(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {OLLAMA_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            The model will be downloaded automatically on first use.
          </p>
        </div>
      )}

      {/* Anthropic settings */}
      {llmProvider === 'anthropic' && (
        <div className="mb-4 space-y-4">
          {/* Auth mode toggle — only when both credentials are configured */}
          {hasApiKey && hasOauthToken && (
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Authentication Method
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => saveAnthropicAuthMode('api_key')}
                  disabled={isFetchingLlmStatus}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    anthropicAuthMode === 'api_key'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                      : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  API Key
                </button>
                <button
                  onClick={() => saveAnthropicAuthMode('oauth')}
                  disabled={isFetchingLlmStatus}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    anthropicAuthMode === 'oauth'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                      : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  OAuth Token
                </button>
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                Both credentials are configured. Choose which to use — connection will be tested
                automatically.
              </p>
            </div>
          )}

          {/* API Key */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              API Key
            </label>
            <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-500">
              Get your API key from{' '}
              <a
                href="https://console.anthropic.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                console.anthropic.com
              </a>
            </p>
            {hasApiKey && !editingApiKey ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                  Configured
                </span>
                <button
                  onClick={() => setEditingApiKey(true)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  Replace
                </button>
                <button
                  onClick={clearAnthropicApiKey}
                  className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-zinc-800 dark:text-red-400 dark:hover:bg-red-900/20"
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
                  className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
                <button
                  onClick={() => saveAnthropicApiKey(newApiKey)}
                  disabled={!newApiKey.trim()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>
                {editingApiKey && (
                  <button
                    onClick={() => {
                      setEditingApiKey(false);
                      setNewApiKey('');
                    }}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-zinc-200 dark:border-zinc-700" />
            <span className="mx-3 flex-shrink text-xs text-zinc-400 dark:text-zinc-500">or</span>
            <div className="flex-grow border-t border-zinc-200 dark:border-zinc-700" />
          </div>

          {/* OAuth Token */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              OAuth Token <span className="font-normal text-zinc-400">(Pro/Team plan)</span>
            </label>
            <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-500">
              Uses your Claude Pro or Team subscription credits. Run{' '}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">claude setup-token</code>{' '}
              to obtain a token. Note: slower initial startup than API keys.
            </p>
            {hasOauthToken && !editingOauthToken ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                  Configured
                </span>
                <button
                  onClick={() => setEditingOauthToken(true)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  Replace
                </button>
                <button
                  onClick={clearClaudeOauthToken}
                  className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-zinc-800 dark:text-red-400 dark:hover:bg-red-900/20"
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
                  className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
                <button
                  onClick={() => saveClaudeOauthToken(newOauthToken)}
                  disabled={!newOauthToken.trim()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>
                {editingOauthToken && (
                  <button
                    onClick={() => {
                      setEditingOauthToken(false);
                      setNewOauthToken('');
                    }}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* LM Studio settings */}
      {llmProvider === 'lmstudio' && (
        <div className="mb-4 space-y-4" data-testid="lmstudio-settings">
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Endpoint
            </label>
            <input
              type="text"
              value={lmstudioUrl}
              onChange={(e) => saveLmstudioUrl(e.target.value)}
              placeholder="http://localhost:1234"
              data-testid="lmstudio-endpoint"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              The URL of your LM Studio server (default port 1234). The app talks to it server-side,
              so localhost works even when lector is hosted elsewhere — set this to a reachable
              address.
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              API Key (optional)
            </label>
            {hasLmstudioApiKey && !editingLmstudioApiKey ? (
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex items-center rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  data-testid="lmstudio-api-key-status"
                >
                  Configured
                </span>
                <button
                  type="button"
                  onClick={() => setEditingLmstudioApiKey(true)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  data-testid="lmstudio-api-key-replace"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={clearLmstudioApiKey}
                  className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:bg-zinc-800 dark:text-red-400 dark:hover:bg-red-900/20"
                  data-testid="lmstudio-api-key-clear"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newLmstudioApiKey}
                  onChange={(e) => setNewLmstudioApiKey(e.target.value)}
                  placeholder="leave empty unless your LM Studio is behind auth"
                  data-testid="lmstudio-api-key"
                  className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
                <button
                  type="button"
                  onClick={() => saveLmstudioApiKey(newLmstudioApiKey)}
                  disabled={!newLmstudioApiKey.trim()}
                  className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  data-testid="lmstudio-api-key-save"
                >
                  Save
                </button>
                {editingLmstudioApiKey && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingLmstudioApiKey(false);
                      setNewLmstudioApiKey('');
                    }}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              Sent as a Bearer token from the server (never exposed to the browser after save). Only
              needed for reverse-proxied or LM Studio Cloud setups.
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Model
            </label>
            <div className="flex gap-2">
              <select
                value={lmstudioModel}
                onChange={(e) => saveLmstudioModel(e.target.value)}
                data-testid="lmstudio-model"
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {/* Always include an empty placeholder so a freshly-fetched
                          dropdown doesn't visually show a "selected" model that
                          state doesn't actually know about (would leave Load disabled). */}
                <option value="" disabled>
                  {lmstudioModels.length === 0
                    ? lmstudioFetchingModels
                      ? 'Fetching models…'
                      : '— click “Fetch models” to populate —'
                    : 'Select a model…'}
                </option>
                {lmstudioModel && !lmstudioModels.includes(lmstudioModel) && (
                  <option value={lmstudioModel}>{lmstudioModel} (saved)</option>
                )}
                {lmstudioModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={fetchLmstudioModels}
                disabled={lmstudioFetchingModels || !lmstudioUrl}
                data-testid="lmstudio-fetch-models"
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                {lmstudioFetchingModels ? 'Fetching...' : 'Fetch models'}
              </button>
            </div>
            {lmstudioFetchError && (
              <p
                className="mt-1 text-xs text-red-600 dark:text-red-400"
                data-testid="lmstudio-fetch-error"
              >
                {lmstudioFetchError}
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Load model
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={loadLmstudioModel}
                disabled={!lmstudioModel || lmstudioLoadStatus === 'loading'}
                data-testid="lmstudio-load"
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                {lmstudioLoadStatus === 'loading' ? 'Loading...' : 'Load'}
              </button>
              <span
                data-testid="lmstudio-load-status"
                data-status={lmstudioLoadStatus}
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  lmstudioLoadStatus === 'loaded'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                    : lmstudioLoadStatus === 'loading'
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                      : lmstudioLoadStatus === 'errored'
                        ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {lmstudioLoadStatus === 'idle'
                  ? 'Idle'
                  : lmstudioLoadStatus === 'loading'
                    ? 'Loading…'
                    : lmstudioLoadStatus === 'loaded'
                      ? 'Loaded'
                      : 'Errored'}
              </span>
            </div>
            {lmstudioLoadError && (
              <p
                className="mt-1 text-xs text-red-600 dark:text-red-400"
                data-testid="lmstudio-load-error"
              >
                {lmstudioLoadError}
              </p>
            )}
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              Loads the selected model on the LM Studio server. Make sure LM Studio&apos;s
              &ldquo;auto-load&rdquo; is enabled if you want JIT loading on chat too.
            </p>
          </div>
        </div>
      )}

      {/* Apfel settings */}
      {llmProvider === 'apfel' && (
        <div className="mb-4 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Server URL
            </label>
            <input
              type="text"
              value={apfelUrl}
              onChange={(e) => saveApfelUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              The URL of your Apfel instance (OpenAI-compatible API)
            </p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Model
            </label>
            <input
              type="text"
              value={apfelModel}
              onChange={(e) => saveApfelModel(e.target.value)}
              placeholder="default"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              The model name configured on your Apfel server
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
