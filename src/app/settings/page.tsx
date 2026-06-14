'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import NavHeader from '@/components/NavHeader';
import { getDeckNames, isAnkiConnected, refreshAnkiUrl } from '@/lib/anki';
import { getTTSMode, setTTSMode, isGoogleTTSConfigured, speak, type TTSMode } from '@/lib/tts';
import {
  exportAllData,
  bulkUpdateWordStates,
  getSetting,
  setSetting,
  deleteSetting,
  importFromDexie,
  getAllVocab,
  getAllKnownWords,
  getVocabByText,
  saveVocab,
  updateVocabState,
  getApiTokens,
  createApiToken,
  revokeApiToken,
  type ApiTokenMeta,
  type WordState,
} from '@/lib/data-layer';
import { OLLAMA_MODELS, SETTINGS_KEYS } from './constants';
import { AppSettings, CardType, LLMProvider, LLMStatus, LMStudioLoadStatus, Theme } from './types';
import { Button } from '@/components/ui/button';

const defaultSettings: AppSettings = {
  apiKey: '',
  ankiDeckName: 'Afrikaans',
  ankiClozeDeckName: 'Afrikaans::Cloze',
  defaultCardType: 'basic',
  ttsSpeed: 1.0,
  ttsMode: 'google',
  theme: 'system',
};

export default function SettingsPage() {
  // Settings state
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  // Anki state
  const [ankiConnected, setAnkiConnected] = useState(false);
  const [ankiDecks, setAnkiDecks] = useState<string[]>([]);
  const [ankiLoading, setAnkiLoading] = useState(false);
  const [ankiError, setAnkiError] = useState<string | null>(null);
  const [ankiConnectUrl, setAnkiConnectUrl] = useState('http://localhost:8765');

  // Import state
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Data management state
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // LLM provider state
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
  const [llmStatus, setLlmStatus] = useState<LLMStatus | null>(null);
  const [llmTesting, setLlmTesting] = useState(false);

  // TTS state
  const [googleTTSAvailable, setGoogleTTSAvailable] = useState<boolean | null>(null);

  // Time zone state (server-side setting — drives day rollover for daily
  // stats, streaks and review days; issue #108)
  const [timezone, setTimezone] = useState<string>('');
  const [timezones, setTimezones] = useState<string[]>([]);
  const [browserTimeZone, setBrowserTimeZone] = useState<string>('');

  // API Token state
  const [apiTokens, setApiTokens] = useState<ApiTokenMeta[]>([]);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenScopes, setNewTokenScopes] = useState<string[]>(['*']);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Load settings from localStorage on mount
  useEffect(() => {
    const loadedSettings: AppSettings = {
      apiKey: localStorage.getItem(SETTINGS_KEYS.ANTHROPIC_API_KEY) || '',
      ankiDeckName: localStorage.getItem(SETTINGS_KEYS.ANKI_DECK_NAME) || 'Afrikaans',
      ankiClozeDeckName:
        localStorage.getItem(SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME) || 'Afrikaans::Cloze',
      defaultCardType:
        (localStorage.getItem(SETTINGS_KEYS.DEFAULT_CARD_TYPE) as CardType) || 'basic',
      ttsSpeed: parseFloat(localStorage.getItem(SETTINGS_KEYS.TTS_SPEED) || '1.0'),
      ttsMode: getTTSMode(),
      theme: (localStorage.getItem(SETTINGS_KEYS.THEME) as Theme) || 'system',
    };
    setSettings(loadedSettings);

    // Apply theme on load
    applyTheme(loadedSettings.theme);

    // Load AnkiConnect URL from IndexedDB
    getSetting<string>('ankiConnectUrl').then((url) => {
      if (url) setAnkiConnectUrl(url);
    });

    // Check if Google TTS is configured
    isGoogleTTSConfigured().then(setGoogleTTSAvailable);

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

    // Check LLM status
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});

    // Load API tokens
    getApiTokens()
      .then(setApiTokens)
      .catch(() => {});

    // Time zone: populate the IANA list and the saved value
    setBrowserTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const intlWithSupported = Intl as typeof Intl & {
      supportedValuesOf?: (key: 'timeZone') => string[];
    };
    setTimezones(
      intlWithSupported.supportedValuesOf ? intlWithSupported.supportedValuesOf('timeZone') : [],
    );
    getSetting<string>('timezone').then((tz) => {
      if (tz) setTimezone(tz);
    });
  }, []);

  // Save the day-rollover time zone ('' = auto, server's zone)
  const saveTimezone = async (tz: string) => {
    setTimezone(tz);
    await setSetting('timezone', tz);
  };

  // Check Anki connection
  const checkAnkiConnection = useCallback(async () => {
    setAnkiLoading(true);
    setAnkiError(null);
    try {
      const connected = await isAnkiConnected();
      setAnkiConnected(connected);
      if (connected) {
        const decks = await getDeckNames();
        setAnkiDecks(decks);
      }
    } catch {
      setAnkiError(
        'Failed to connect to Anki. Make sure Anki is running with AnkiConnect installed.',
      );
      setAnkiConnected(false);
    } finally {
      setAnkiLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAnkiConnection();
  }, [checkAnkiConnection]);

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

  // Apply theme to document
  const applyTheme = (theme: Theme) => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      // System preference
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
  };

  // Save individual setting
  const saveSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));

    // Map to localStorage key
    const storageKeyMap: Record<keyof AppSettings, string> = {
      apiKey: SETTINGS_KEYS.ANTHROPIC_API_KEY,
      ankiDeckName: SETTINGS_KEYS.ANKI_DECK_NAME,
      ankiClozeDeckName: SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME,
      defaultCardType: SETTINGS_KEYS.DEFAULT_CARD_TYPE,
      ttsSpeed: SETTINGS_KEYS.TTS_SPEED,
      ttsMode: '', // Handled separately
      theme: SETTINGS_KEYS.THEME,
    };

    if (key === 'ttsMode') {
      setTTSMode(value as TTSMode);
    } else {
      localStorage.setItem(storageKeyMap[key], String(value));
    }

    // Apply theme immediately if changed
    if (key === 'theme') {
      applyTheme(value as Theme);
    }
  };

  // Save LLM provider setting
  const saveLLMProvider = async (provider: LLMProvider) => {
    setLlmProvider(provider);
    await setSetting('llmProvider', provider);
    // Reset the cached provider on the server
    await fetch('/api/llm-status/reset', { method: 'POST' });
    // Refresh status
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});
  };

  const saveOllamaModel = async (model: string) => {
    setOllamaModel(model);
    await setSetting('ollamaModel', model);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});
  };

  const saveApfelUrl = async (url: string) => {
    setApfelUrl(url);
    await setSetting('apfelUrl', url);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});
  };

  const saveApfelModel = async (model: string) => {
    setApfelModel(model);
    await setSetting('apfelModel', model);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});
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
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});
  };

  const saveLmstudioApiKey = async (key: string) => {
    if (!key.trim()) return;
    await setSetting('lmstudioApiKey', key);
    setHasLmstudioApiKey(true);
    setNewLmstudioApiKey('');
    setEditingLmstudioApiKey(false);
    await resetLmstudioModelSelection();
    await fetch('/api/llm-status/reset', { method: 'POST' });
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});
  };

  const clearLmstudioApiKey = async () => {
    await deleteSetting('lmstudioApiKey');
    setHasLmstudioApiKey(false);
    setNewLmstudioApiKey('');
    setEditingLmstudioApiKey(false);
    await resetLmstudioModelSelection();
    await fetch('/api/llm-status/reset', { method: 'POST' });
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});
  };

  const saveLmstudioModel = async (model: string) => {
    setLmstudioModel(model);
    await setSetting('lmstudioModel', model);
    setLmstudioLoadStatus('idle');
    setLmstudioLoadError(null);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});
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
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});
  };

  const clearAnthropicApiKey = async () => {
    await deleteSetting('anthropicApiKey');
    setHasApiKey(false);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});
  };

  const saveClaudeOauthToken = async (token: string) => {
    await setSetting('claudeOauthToken', token);
    setHasOauthToken(true);
    setNewOauthToken('');
    setEditingOauthToken(false);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});
  };

  const clearClaudeOauthToken = async () => {
    await deleteSetting('claudeOauthToken');
    setHasOauthToken(false);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    fetch('/api/llm-status')
      .then((r) => r.json())
      .then(setLlmStatus)
      .catch(() => {});
  };

  const saveAnthropicAuthMode = async (mode: 'api_key' | 'oauth') => {
    setAnthropicAuthMode(mode);
    await setSetting('anthropicAuthMode', mode);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    setLlmTesting(true);
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
      setLlmTesting(false);
    }
  };

  const testLLMConnection = async () => {
    setLlmTesting(true);
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
      setLlmTesting(false);
    }
  };

  // Parse CSV line handling quoted fields
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  // Map LingQ status to our word state
  const lingqStatusToState = (status: string): WordState => {
    switch (status) {
      case '1':
        return 'level1';
      case '2':
        return 'level2';
      case '3':
        return 'level3';
      case '4':
        return 'level4';
      case 'K':
      case 'k':
      case '5':
        return 'known';
      default:
        return 'level1';
    }
  };

  // Handle CSV file upload for known words (supports LingQ format)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length === 0) {
        setImportStatus('No data found in file.');
        return;
      }

      // Check if this looks like a LingQ export (has header row)
      const firstLine = lines[0].toLowerCase();
      const isLingQFormat =
        firstLine.includes('term') || firstLine.includes('hint') || firstLine.includes('status');

      if (isLingQFormat) {
        // LingQ CSV format: term, hint (translation), status, etc.
        const header = parseCSVLine(lines[0].toLowerCase());
        const termIdx = header.findIndex((h) => h === 'term' || h === 'word');
        const hintIdx = header.findIndex((h) => h === 'hint' || h === 'translation');
        const statusIdx = header.findIndex((h) => h === 'status');

        if (termIdx === -1) {
          setImportStatus("Could not find 'term' column in LingQ export.");
          return;
        }

        const imports: { word: string; state: WordState; translation?: string }[] = [];

        for (let i = 1; i < lines.length; i++) {
          const fields = parseCSVLine(lines[i]);
          const word = fields[termIdx]?.toLowerCase().trim();
          if (!word) continue;

          const status = statusIdx >= 0 ? fields[statusIdx] : 'K';
          const translation = hintIdx >= 0 ? fields[hintIdx] : undefined;

          imports.push({
            word,
            state: lingqStatusToState(status),
            translation,
          });
        }

        // Import with states and translations
        await importLingQWords(imports);
        const knownCount = imports.filter((i) => i.state === 'known').length;
        const learningCount = imports.length - knownCount;
        setImportStatus(
          `Imported ${imports.length} words from LingQ: ${knownCount} known, ${learningCount} learning.`,
        );
      } else {
        // Simple format: one word per line or first CSV column
        const words = lines
          .map((line) => {
            const parts = line.split(',');
            return parts[0].trim().toLowerCase();
          })
          .filter((w) => w.length > 0);

        await importKnownWords(words);
        setImportStatus(`Successfully imported ${words.length} words as known.`);
      }
    } catch (error) {
      setImportStatus(
        `Error importing file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Import LingQ words with their states and translations
  const importLingQWords = async (
    imports: { word: string; state: WordState; translation?: string }[],
  ) => {
    for (const item of imports) {
      // Check if word already exists
      const existing = await getVocabByText(item.word);

      if (existing) {
        // Update state if the LingQ state is "more known"
        const stateRank: Record<WordState, number> = {
          new: 0,
          level1: 1,
          level2: 2,
          level3: 3,
          level4: 4,
          known: 5,
          ignored: -1,
        };
        if (stateRank[item.state] > stateRank[existing.state]) {
          await updateVocabState(existing.id, item.state);
        }
      } else {
        // Create new entry
        await saveVocab({
          id: crypto.randomUUID(),
          text: item.word,
          type: 'word',
          sentence: '',
          translation: item.translation || '',
          state: item.state,
          stateUpdatedAt: new Date(),
          reviewCount: 0,
          createdAt: new Date(),
          pushedToAnki: false,
        });
      }
    }

    // Also update known words table for fast lookup
    const updates = imports.map((i) => ({ word: i.word, state: i.state }));
    await bulkUpdateWordStates(updates);
  };

  // Handle paste text area import
  const handleTextImport = async () => {
    const words = importText
      .split(/[\r\n]+/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length > 0);

    if (words.length === 0) {
      setImportStatus('No words to import.');
      return;
    }

    await importKnownWords(words);
    setImportStatus(`Successfully imported ${words.length} words as known.`);
    setImportText('');
  };

  // Import words as known
  const importKnownWords = async (words: string[]) => {
    const updates = words.map((word) => ({
      word,
      state: 'known' as WordState,
    }));
    await bulkUpdateWordStates(updates);
  };

  // Export vocab as CSV
  const exportVocabCSV = async () => {
    try {
      const vocab = await getAllVocab();
      const csv = [
        'text,type,sentence,translation,state,createdAt',
        ...vocab.map(
          (v) =>
            `"${v.text}","${v.type}","${v.sentence.replace(/"/g, '""')}","${v.translation.replace(/"/g, '""')}","${v.state}","${v.createdAt.toISOString()}"`,
        ),
      ].join('\n');

      downloadFile(csv, 'afrikaans-vocab.csv', 'text/csv');
      setExportStatus('Vocab exported as CSV.');
    } catch (error) {
      setExportStatus(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Export vocab as JSON
  const exportVocabJSON = async () => {
    try {
      const vocab = await getAllVocab();
      const json = JSON.stringify(vocab, null, 2);
      downloadFile(json, 'afrikaans-vocab.json', 'application/json');
      setExportStatus('Vocab exported as JSON.');
    } catch (error) {
      setExportStatus(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Export all known words
  const exportKnownWords = async () => {
    try {
      const knownWords = await getAllKnownWords();
      const words = knownWords.filter((w) => w.state === 'known').map((w) => w.word);
      const text = words.join('\n');
      downloadFile(text, 'afrikaans-known-words.txt', 'text/plain');
      setExportStatus(`Exported ${words.length} known words.`);
    } catch (error) {
      setExportStatus(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Export full backup
  const exportFullBackup = async () => {
    try {
      const data = await exportAllData();
      const exportData = {
        ...data,
        exportedAt: new Date().toISOString(),
        version: 2,
      };
      const json = JSON.stringify(exportData, null, 2);
      downloadFile(json, 'lector-backup.json', 'application/json');
      setExportStatus('Full backup exported.');
    } catch (error) {
      setExportStatus(`Backup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Import backup
  const handleBackupImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate backup format
      if (!data.version || !data.exportedAt) {
        throw new Error('Invalid backup file format');
      }

      // Use the server-side import API
      const result = await importFromDexie(data);

      if (result.success) {
        const counts = result.imported;
        setExportStatus(
          `Backup imported: ${counts.collections || 0} collections, ${counts.lessons || 0} lessons, ${counts.vocab || 0} vocab, ${counts.knownWords || 0} known words, ${counts.clozeSentences || 0} cloze sentences.`,
        );
      } else {
        throw new Error('Import failed');
      }
    } catch (error) {
      setExportStatus(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Reset file input
    e.target.value = '';
  };

  // Helper to download a file
  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Header — mobile only, desktop uses sidebar */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur-sm sm:hidden dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link
            href="/"
            className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            &larr; Back
          </Link>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Settings</h1>
          <div className="w-12" /> {/* Spacer for centering */}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="space-y-8">
          {/* AI Provider Section */}
          <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                AI Provider
              </h2>
              {llmStatus && (
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      llmStatus.ok ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {llmStatus.ok ? 'Connected' : llmStatus.error || 'Not connected'}
                  </span>
                </div>
              )}
            </div>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Choose how translations are powered. Ollama runs locally (no API key needed).
              Anthropic uses cloud AI for higher quality. Apfel is an OpenAI-compatible API you can
              self-host.
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
                        disabled={llmTesting}
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
                        disabled={llmTesting}
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
                      Both credentials are configured. Choose which to use — connection will be
                      tested automatically.
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
                  <span className="mx-3 flex-shrink text-xs text-zinc-400 dark:text-zinc-500">
                    or
                  </span>
                  <div className="flex-grow border-t border-zinc-200 dark:border-zinc-700" />
                </div>

                {/* OAuth Token */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    OAuth Token <span className="font-normal text-zinc-400">(Pro/Team plan)</span>
                  </label>
                  <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-500">
                    Uses your Claude Pro or Team subscription credits. Run{' '}
                    <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
                      claude setup-token
                    </code>{' '}
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
                    The URL of your LM Studio server (default port 1234). The app talks to it
                    server-side, so localhost works even when lector is hosted elsewhere — set this
                    to a reachable address.
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
                    Sent as a Bearer token from the server (never exposed to the browser after
                    save). Only needed for reverse-proxied or LM Studio Cloud setups.
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

            <Button variant="secondary" onClick={testLLMConnection} disabled={llmTesting}>
              {llmTesting ? 'Testing...' : 'Test Connection'}
            </Button>
          </section>

          {/* Anki Settings Section */}
          <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Anki Integration
              </h2>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    ankiConnected ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {ankiConnected ? 'Connected' : 'Not connected'}
                </span>
                <Button variant="link" onClick={checkAnkiConnection} disabled={ankiLoading}>
                  {ankiLoading ? 'Checking...' : 'Refresh'}
                </Button>
              </div>
            </div>

            {ankiError && (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {ankiError}
              </div>
            )}

            {/* AnkiConnect URL */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                AnkiConnect URL
              </label>
              <input
                type="text"
                value={ankiConnectUrl}
                onChange={(e) => {
                  setAnkiConnectUrl(e.target.value);
                  setSetting('ankiConnectUrl', e.target.value);
                  // Invalidate the anki.ts URL cache so the next request
                  // (e.g. the connection check below) uses the new value.
                  refreshAnkiUrl();
                }}
                placeholder="http://localhost:8765"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                Use Tailscale IP for remote Anki (e.g., http://100.x.x.x:8765)
              </p>
            </div>

            {/* Deck Selector */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Vocab Deck
              </label>
              {ankiConnected && ankiDecks.length > 0 ? (
                <select
                  value={settings.ankiDeckName}
                  onChange={(e) => saveSetting('ankiDeckName', e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {ankiDecks.map((deck) => (
                    <option key={deck} value={deck}>
                      {deck}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={settings.ankiDeckName}
                  onChange={(e) => saveSetting('ankiDeckName', e.target.value)}
                  placeholder="Deck name"
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              )}
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                Deck for basic cards from reader vocabulary
              </p>
            </div>

            {/* Cloze Deck Name */}
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Cloze Practice Deck
              </label>
              {ankiConnected && ankiDecks.length > 0 ? (
                <select
                  value={settings.ankiClozeDeckName}
                  onChange={(e) => saveSetting('ankiClozeDeckName', e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {ankiDecks.map((deck) => (
                    <option key={deck} value={deck}>
                      {deck}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={settings.ankiClozeDeckName}
                  onChange={(e) => saveSetting('ankiClozeDeckName', e.target.value)}
                  placeholder="Cloze deck name"
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              )}
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                Deck for cloze cards from practice mode
              </p>
            </div>

            {/* Card Type Toggle */}
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Default Card Type
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => saveSetting('defaultCardType', 'basic')}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    settings.defaultCardType === 'basic'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                      : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  Basic
                </button>
                <button
                  onClick={() => saveSetting('defaultCardType', 'cloze')}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    settings.defaultCardType === 'cloze'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                      : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  Cloze
                </button>
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                Basic shows front/back, Cloze creates fill-in-the-blank cards
              </p>
            </div>
          </section>

          {/* TTS Settings Section */}
          <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Text-to-Speech
              </h2>
              {googleTTSAvailable !== null && (
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      googleTTSAvailable ? 'bg-green-500' : 'bg-yellow-500'
                    }`}
                  />
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {googleTTSAvailable ? 'Google TTS Active' : 'Using Browser TTS'}
                  </span>
                </div>
              )}
            </div>

            {/* TTS Mode Toggle */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Voice Engine
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => saveSetting('ttsMode', 'google')}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    settings.ttsMode === 'google'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                      : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  Google Cloud
                </button>
                <button
                  onClick={() => saveSetting('ttsMode', 'browser')}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    settings.ttsMode === 'browser'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                      : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  Browser Built-in
                </button>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Google Cloud has better pronunciation, browser is free
              </p>
            </div>

            {/* Test TTS */}
            <div className="mb-4">
              <button
                onClick={() => speak('Hallo, hoe gaan dit met jou?', settings.ttsSpeed)}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Test Voice
              </button>
            </div>

            {/* Speed Slider */}
            <div>
              <label className="mb-2 flex items-center justify-between text-sm font-medium text-zinc-700 dark:text-zinc-300">
                <span>Speech Speed</span>
                <span className="font-mono text-zinc-500">{settings.ttsSpeed.toFixed(1)}x</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={settings.ttsSpeed}
                onChange={(e) => saveSetting('ttsSpeed', parseFloat(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="mt-1 flex justify-between text-xs text-zinc-500">
                <span>0.5x (Slow)</span>
                <span>1.0x</span>
                <span>2.0x (Fast)</span>
              </div>
            </div>
          </section>

          {/* Theme Section */}
          <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Appearance
            </h2>
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Theme
              </label>
              <div className="flex gap-2">
                {(['light', 'dark', 'system'] as Theme[]).map((theme) => (
                  <button
                    key={theme}
                    onClick={() => saveSetting('theme', theme)}
                    className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium capitalize transition-colors ${
                      settings.theme === theme
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                        : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {theme}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Time Zone Section */}
          <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Time Zone
            </h2>
            <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
              Daily stats, streaks and review days roll over at midnight in this time zone.
            </p>
            <select
              value={timezone}
              onChange={(e) => saveTimezone(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">Auto — server time zone</option>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            {browserTimeZone && timezone !== browserTimeZone && (
              <button
                onClick={() => saveTimezone(browserTimeZone)}
                className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Use this device&apos;s time zone ({browserTimeZone})
              </button>
            )}
          </section>

          {/* API Tokens Section */}
          <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">API Tokens</h2>
              {!showTokenForm && !createdToken && (
                <Button
                  onClick={() => {
                    setShowTokenForm(true);
                    setTokenError(null);
                  }}
                >
                  Generate Token
                </Button>
              )}
            </div>

            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Create personal access tokens for CLI or API access. Tokens are scoped to specific
              permissions.
            </p>

            {tokenError && (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {tokenError}
              </div>
            )}

            {/* One-time token display */}
            {createdToken && (
              <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
                <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                  Copy this token now — it won&apos;t be shown again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded border border-amber-200 bg-white px-3 py-2 font-mono text-sm break-all text-zinc-900 select-all dark:border-amber-800 dark:bg-zinc-800 dark:text-zinc-100">
                    {createdToken}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(createdToken);
                      setTokenCopied(true);
                      setTimeout(() => setTokenCopied(false), 2000);
                    }}
                    className="shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    {tokenCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <button
                  onClick={() => setCreatedToken(null)}
                  className="mt-3 text-sm text-amber-700 underline hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
                >
                  I&apos;ve saved this token
                </button>
              </div>
            )}

            {/* Create token form */}
            {showTokenForm && (
              <div className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                <div className="mb-3">
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Token Name
                  </label>
                  <input
                    type="text"
                    value={newTokenName}
                    onChange={(e) => setNewTokenName(e.target.value)}
                    placeholder="e.g. CLI, Automation, Backup script"
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  />
                </div>

                <div className="mb-3">
                  <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Scopes
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: '*', label: 'Full Access' },
                      { value: 'collections:read', label: 'Collections (read)' },
                      { value: 'collections:write', label: 'Collections (write)' },
                      { value: 'vocab:read', label: 'Vocabulary (read)' },
                      { value: 'vocab:write', label: 'Vocabulary (write)' },
                      { value: 'stats:read', label: 'Stats (read)' },
                      { value: 'stats:write', label: 'Stats (write)' },
                      { value: 'settings:read', label: 'Settings (read)' },
                      { value: 'settings:write', label: 'Settings (write)' },
                      { value: 'data:export', label: 'Data Export' },
                      { value: 'data:import', label: 'Data Import' },
                    ].map(({ value, label }) => (
                      <label
                        key={value}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                          newTokenScopes.includes(value)
                            ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                            : 'border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                        } ${
                          newTokenScopes.includes('*') && value !== '*'
                            ? 'cursor-not-allowed opacity-50'
                            : 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={newTokenScopes.includes('*') || newTokenScopes.includes(value)}
                          disabled={newTokenScopes.includes('*') && value !== '*'}
                          onChange={(e) => {
                            if (value === '*') {
                              setNewTokenScopes(e.target.checked ? ['*'] : []);
                            } else {
                              setNewTokenScopes((prev) =>
                                e.target.checked
                                  ? [...prev.filter((s) => s !== '*'), value]
                                  : prev.filter((s) => s !== value),
                              );
                            }
                          }}
                          className="rounded"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!newTokenName.trim()) {
                        setTokenError('Token name is required');
                        return;
                      }
                      if (newTokenScopes.length === 0) {
                        setTokenError('Select at least one scope');
                        return;
                      }
                      try {
                        setTokenError(null);
                        const result = await createApiToken({
                          name: newTokenName.trim(),
                          scopes: newTokenScopes,
                        });
                        setCreatedToken(result.token);
                        setShowTokenForm(false);
                        setNewTokenName('');
                        setNewTokenScopes(['*']);
                        const tokens = await getApiTokens();
                        setApiTokens(tokens);
                      } catch (err) {
                        setTokenError(
                          err instanceof Error ? err.message : 'Failed to create token',
                        );
                      }
                    }}
                    disabled={!newTokenName.trim() || newTokenScopes.length === 0}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Create Token
                  </button>
                  <button
                    onClick={() => {
                      setShowTokenForm(false);
                      setNewTokenName('');
                      setNewTokenScopes(['*']);
                      setTokenError(null);
                    }}
                    className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Token list */}
            {apiTokens.length > 0 ? (
              <div className="space-y-2">
                {apiTokens.map((token) => (
                  <div
                    key={token.id}
                    className="flex items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {token.name}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {(token.scopes.includes('*') ? ['Full Access'] : token.scopes).map(
                            (scope) => (
                              <span
                                key={scope}
                                className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                              >
                                {scope}
                              </span>
                            ),
                          )}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Created {new Date(token.createdAt).toLocaleDateString()}
                        {token.lastUsedAt
                          ? ` · Last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                          : ' · Never used'}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        if (!confirm(`Revoke token "${token.name}"? This cannot be undone.`))
                          return;
                        await revokeApiToken(token.id);
                        setApiTokens((prev) => prev.filter((t) => t.id !== token.id));
                      }}
                      className="ml-3 shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              !showTokenForm && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No tokens created yet. Generate one to use the CLI or access the API remotely.
                </p>
              )
            )}
          </section>

          {/* Known Words Import Section */}
          <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Import Known Words
            </h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Import words you already know. Supports <strong>LingQ exports</strong> (with status
              levels and translations) or simple word lists.
            </p>
            <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-500">
              LingQ: Vocabulary → Settings gear → Export LingQs → Upload the CSV here
            </p>

            {/* CSV Upload */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Upload CSV File
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="block w-full text-sm text-zinc-600 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100 dark:text-zinc-400 dark:file:bg-blue-900/20 dark:file:text-blue-400"
              />
              <p className="mt-1 text-xs text-zinc-500">
                CSV with words in the first column, or a plain text file
              </p>
            </div>

            {/* Text Area Import */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Or Paste Words (one per line)
              </label>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="die&#10;en&#10;is&#10;van&#10;..."
                rows={6}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </div>

            <Button variant="secondary" onClick={handleTextImport} disabled={!importText.trim()}>
              Import
            </Button>

            {importStatus && (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{importStatus}</p>
            )}
          </section>

          {/* Export Section */}
          <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Export Data
            </h2>
            <div className="flex flex-wrap gap-3">
              <Button onClick={exportVocabCSV}>Export Vocab (CSV)</Button>
              <Button onClick={exportVocabJSON}>Export Vocab (JSON)</Button>
              <Button onClick={exportKnownWords}>Export Known Words</Button>
            </div>
            {exportStatus && (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{exportStatus}</p>
            )}
          </section>

          {/* Data Management Section */}
          <section className="rounded-lg border border-red-200 bg-white p-6 dark:border-red-900/50 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Data Management
            </h2>

            <div className="mb-6 flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={exportFullBackup}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Export Full Backup
              </Button>
              <label className="cursor-pointer rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
                Import Backup
                <input
                  type="file"
                  accept=".json"
                  onChange={handleBackupImport}
                  className="hidden"
                />
              </label>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
