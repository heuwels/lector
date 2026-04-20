"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import NavHeader from "@/components/NavHeader";
import { getDeckNames, isAnkiConnected } from "@/lib/anki";
import { getTTSMode, setTTSMode, isGoogleTTSConfigured, speak, type TTSMode } from "@/lib/tts";
import {
  exportAllData,
  clearAllData,
  bulkUpdateWordStates,
  getSetting,
  setSetting,
  importFromDexie,
  getAllVocab,
  getAllKnownWords,
  getVocabByText,
  saveVocab,
  updateVocabState,
  type VocabEntry,
  type KnownWord,
  type WordState,
} from "@/lib/data-layer";

// Settings keys for localStorage
const SETTINGS_KEYS = {
  ANTHROPIC_API_KEY: "lector-api-key",
  GOOGLE_CLOUD_API_KEY: "lector-google-api-key",
  ANKI_DECK_NAME: "lector-anki-deck",
  ANKI_CLOZE_DECK_NAME: "lector-anki-cloze-deck",
  DEFAULT_CARD_TYPE: "lector-card-type",
  TTS_SPEED: "lector-tts-speed",
  THEME: "lector-theme",
} as const;

type CardType = "basic" | "cloze";
type Theme = "light" | "dark" | "system";
type LLMProvider = "ollama" | "anthropic" | "apfel";

const OLLAMA_MODELS = [
  { value: "llama3.2:3b", label: "Llama 3.2 3B (fastest, lower quality)" },
  { value: "llama3.1:8b", label: "Llama 3.1 8B (default, fast)" },
  { value: "gemma2:9b", label: "Gemma 2 9B (best quality, needs ~6GB RAM)" },
] as const;

interface LLMStatus {
  provider: string;
  model: string;
  ok: boolean;
  error?: string;
}

interface AppSettings {
  apiKey: string;
  googleApiKey: string;
  ankiDeckName: string;
  ankiClozeDeckName: string;
  defaultCardType: CardType;
  ttsSpeed: number;
  ttsMode: TTSMode;
  theme: Theme;
}

const defaultSettings: AppSettings = {
  apiKey: "",
  googleApiKey: "",
  ankiDeckName: "Afrikaans",
  ankiClozeDeckName: "Afrikaans::Cloze",
  defaultCardType: "basic",
  ttsSpeed: 1.0,
  ttsMode: "google",
  theme: "system",
};

export default function SettingsPage() {
  // Settings state
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [showApiKey, setShowApiKey] = useState(false);

  // Anki state
  const [ankiConnected, setAnkiConnected] = useState(false);
  const [ankiDecks, setAnkiDecks] = useState<string[]>([]);
  const [ankiLoading, setAnkiLoading] = useState(false);
  const [ankiError, setAnkiError] = useState<string | null>(null);
  const [ankiConnectUrl, setAnkiConnectUrl] = useState("http://localhost:8765");

  // Import state
  const [importText, setImportText] = useState("");
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Data management state
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearConfirmText, setCllearConfirmText] = useState("");
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // LLM provider state
  const [llmProvider, setLlmProvider] = useState<LLMProvider>("ollama");
  const [ollamaModel, setOllamaModel] = useState("llama3.1:8b");
  const [apfelUrl, setApfelUrl] = useState("http://localhost:11434");
  const [apfelModel, setApfelModel] = useState("default");
  const [llmStatus, setLlmStatus] = useState<LLMStatus | null>(null);
  const [llmTesting, setLlmTesting] = useState(false);

  // TTS state
  const [googleTTSAvailable, setGoogleTTSAvailable] = useState<boolean | null>(null);
  const [showGoogleApiKey, setShowGoogleApiKey] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    const loadedSettings: AppSettings = {
      apiKey: localStorage.getItem(SETTINGS_KEYS.ANTHROPIC_API_KEY) || "",
      googleApiKey: localStorage.getItem(SETTINGS_KEYS.GOOGLE_CLOUD_API_KEY) || "",
      ankiDeckName:
        localStorage.getItem(SETTINGS_KEYS.ANKI_DECK_NAME) || "Afrikaans",
      ankiClozeDeckName:
        localStorage.getItem(SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME) || "Afrikaans::Cloze",
      defaultCardType:
        (localStorage.getItem(SETTINGS_KEYS.DEFAULT_CARD_TYPE) as CardType) ||
        "basic",
      ttsSpeed: parseFloat(
        localStorage.getItem(SETTINGS_KEYS.TTS_SPEED) || "1.0"
      ),
      ttsMode: getTTSMode(),
      theme: (localStorage.getItem(SETTINGS_KEYS.THEME) as Theme) || "system",
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
      if (p === 'ollama' || p === 'anthropic' || p === 'apfel') setLlmProvider(p);
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

    // Check LLM status
    fetch('/api/llm-status').then(r => r.json()).then(setLlmStatus).catch(() => {});
  }, []);

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
      setAnkiError("Failed to connect to Anki. Make sure Anki is running with AnkiConnect installed.");
      setAnkiConnected(false);
    } finally {
      setAnkiLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAnkiConnection();
  }, [checkAnkiConnection]);

  // Apply theme to document
  const applyTheme = (theme: Theme) => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      // System preference
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }
  };

  // Save individual setting
  const saveSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));

    // Map to localStorage key
    const storageKeyMap: Record<keyof AppSettings, string> = {
      apiKey: SETTINGS_KEYS.ANTHROPIC_API_KEY,
      googleApiKey: SETTINGS_KEYS.GOOGLE_CLOUD_API_KEY,
      ankiDeckName: SETTINGS_KEYS.ANKI_DECK_NAME,
      ankiClozeDeckName: SETTINGS_KEYS.ANKI_CLOZE_DECK_NAME,
      defaultCardType: SETTINGS_KEYS.DEFAULT_CARD_TYPE,
      ttsSpeed: SETTINGS_KEYS.TTS_SPEED,
      ttsMode: "", // Handled separately
      theme: SETTINGS_KEYS.THEME,
    };

    if (key === "ttsMode") {
      setTTSMode(value as TTSMode);
    } else {
      localStorage.setItem(storageKeyMap[key], String(value));
    }

    // Apply theme immediately if changed
    if (key === "theme") {
      applyTheme(value as Theme);
    }
  };

  // Mask API key for display
  const getMaskedApiKey = (key: string): string => {
    if (!key) return "";
    if (key.length <= 8) return "*".repeat(key.length);
    return key.slice(0, 4) + "*".repeat(key.length - 8) + key.slice(-4);
  };

  // Save LLM provider setting
  const saveLLMProvider = async (provider: LLMProvider) => {
    setLlmProvider(provider);
    await setSetting('llmProvider', provider);
    // Reset the cached provider on the server
    await fetch('/api/llm-status/reset', { method: 'POST' });
    // Refresh status
    fetch('/api/llm-status').then(r => r.json()).then(setLlmStatus).catch(() => {});
  };

  const saveOllamaModel = async (model: string) => {
    setOllamaModel(model);
    await setSetting('ollamaModel', model);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    fetch('/api/llm-status').then(r => r.json()).then(setLlmStatus).catch(() => {});
  };

  const saveApfelUrl = async (url: string) => {
    setApfelUrl(url);
    await setSetting('apfelUrl', url);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    fetch('/api/llm-status').then(r => r.json()).then(setLlmStatus).catch(() => {});
  };

  const saveApfelModel = async (model: string) => {
    setApfelModel(model);
    await setSetting('apfelModel', model);
    await fetch('/api/llm-status/reset', { method: 'POST' });
    fetch('/api/llm-status').then(r => r.json()).then(setLlmStatus).catch(() => {});
  };

  const testLLMConnection = async () => {
    setLlmTesting(true);
    try {
      const res = await fetch('/api/llm-status/test', { method: 'POST' });
      const data = await res.json();
      setLlmStatus(prev => prev ? { ...prev, ok: data.ok, error: data.error } : { provider: llmProvider, model: ollamaModel, ok: data.ok, error: data.error });
    } catch {
      setLlmStatus(prev => prev ? { ...prev, ok: false, error: 'Failed to reach server' } : null);
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
      case '1': return 'level1';
      case '2': return 'level2';
      case '3': return 'level3';
      case '4': return 'level4';
      case 'K':
      case 'k':
      case '5': return 'known';
      default: return 'level1';
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
        setImportStatus("No data found in file.");
        return;
      }

      // Check if this looks like a LingQ export (has header row)
      const firstLine = lines[0].toLowerCase();
      const isLingQFormat = firstLine.includes('term') || firstLine.includes('hint') || firstLine.includes('status');

      if (isLingQFormat) {
        // LingQ CSV format: term, hint (translation), status, etc.
        const header = parseCSVLine(lines[0].toLowerCase());
        const termIdx = header.findIndex(h => h === 'term' || h === 'word');
        const hintIdx = header.findIndex(h => h === 'hint' || h === 'translation');
        const statusIdx = header.findIndex(h => h === 'status');

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
        const knownCount = imports.filter(i => i.state === 'known').length;
        const learningCount = imports.length - knownCount;
        setImportStatus(
          `Imported ${imports.length} words from LingQ: ${knownCount} known, ${learningCount} learning.`
        );
      } else {
        // Simple format: one word per line or first CSV column
        const words = lines.map((line) => {
          const parts = line.split(",");
          return parts[0].trim().toLowerCase();
        }).filter(w => w.length > 0);

        await importKnownWords(words);
        setImportStatus(`Successfully imported ${words.length} words as known.`);
      }
    } catch (error) {
      setImportStatus(`Error importing file: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Import LingQ words with their states and translations
  const importLingQWords = async (
    imports: { word: string; state: WordState; translation?: string }[]
  ) => {
    for (const item of imports) {
      // Check if word already exists
      const existing = await getVocabByText(item.word);

      if (existing) {
        // Update state if the LingQ state is "more known"
        const stateRank: Record<WordState, number> = {
          'new': 0, 'level1': 1, 'level2': 2, 'level3': 3, 'level4': 4, 'known': 5, 'ignored': -1
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
    const updates = imports.map(i => ({ word: i.word, state: i.state }));
    await bulkUpdateWordStates(updates);
  };

  // Handle paste text area import
  const handleTextImport = async () => {
    const words = importText
      .split(/[\r\n]+/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length > 0);

    if (words.length === 0) {
      setImportStatus("No words to import.");
      return;
    }

    await importKnownWords(words);
    setImportStatus(`Successfully imported ${words.length} words as known.`);
    setImportText("");
  };

  // Import words as known
  const importKnownWords = async (words: string[]) => {
    const updates = words.map((word) => ({
      word,
      state: "known" as WordState,
    }));
    await bulkUpdateWordStates(updates);
  };

  // Export vocab as CSV
  const exportVocabCSV = async () => {
    try {
      const vocab = await getAllVocab();
      const csv = [
        "text,type,sentence,translation,state,createdAt",
        ...vocab.map(
          (v) =>
            `"${v.text}","${v.type}","${v.sentence.replace(/"/g, '""')}","${v.translation.replace(/"/g, '""')}","${v.state}","${v.createdAt.toISOString()}"`
        ),
      ].join("\n");

      downloadFile(csv, "afrikaans-vocab.csv", "text/csv");
      setExportStatus("Vocab exported as CSV.");
    } catch (error) {
      setExportStatus(`Export failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  // Export vocab as JSON
  const exportVocabJSON = async () => {
    try {
      const vocab = await getAllVocab();
      const json = JSON.stringify(vocab, null, 2);
      downloadFile(json, "afrikaans-vocab.json", "application/json");
      setExportStatus("Vocab exported as JSON.");
    } catch (error) {
      setExportStatus(`Export failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  // Export all known words
  const exportKnownWords = async () => {
    try {
      const knownWords = await getAllKnownWords();
      const words = knownWords
        .filter((w) => w.state === "known")
        .map((w) => w.word);
      const text = words.join("\n");
      downloadFile(text, "afrikaans-known-words.txt", "text/plain");
      setExportStatus(`Exported ${words.length} known words.`);
    } catch (error) {
      setExportStatus(`Export failed: ${error instanceof Error ? error.message : "Unknown error"}`);
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
      downloadFile(json, "lector-backup.json", "application/json");
      setExportStatus("Full backup exported.");
    } catch (error) {
      setExportStatus(`Backup failed: ${error instanceof Error ? error.message : "Unknown error"}`);
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
        throw new Error("Invalid backup file format");
      }

      // Use the server-side import API
      const result = await importFromDexie(data);

      if (result.success) {
        const counts = result.imported;
        setExportStatus(`Backup imported: ${counts.collections || 0} collections, ${counts.lessons || 0} lessons, ${counts.vocab || 0} vocab, ${counts.knownWords || 0} known words, ${counts.clozeSentences || 0} cloze sentences.`);
      } else {
        throw new Error("Import failed");
      }
    } catch (error) {
      setExportStatus(`Import failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    // Reset file input
    e.target.value = "";
  };

  // Clear all data
  const handleClearAllData = async () => {
    if (clearConfirmText !== "DELETE ALL DATA") {
      setExportStatus("Please type 'DELETE ALL DATA' to confirm.");
      return;
    }

    try {
      await clearAllData();
      // Also clear localStorage settings
      Object.values(SETTINGS_KEYS).forEach((key) => {
        localStorage.removeItem(key);
      });
      setSettings(defaultSettings);
      setShowClearConfirm(false);
      setCllearConfirmText("");
      setExportStatus("All data has been cleared.");
    } catch (error) {
      setExportStatus(`Clear failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  // Helper to download a file
  const downloadFile = (
    content: string,
    filename: string,
    mimeType: string
  ) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 sm:ml-56">
      <NavHeader />
      {/* Header — mobile only, desktop uses sidebar */}
      <header className="sm:hidden sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link
            href="/"
            className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            &larr; Back
          </Link>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Settings
          </h1>
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
                      llmStatus.ok ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {llmStatus.ok ? "Connected" : llmStatus.error || "Not connected"}
                  </span>
                </div>
              )}
            </div>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Choose how translations are powered. Ollama runs locally (no API key needed). Anthropic uses cloud AI for higher quality. Apfel is an OpenAI-compatible API you can self-host.
            </p>

            {/* Provider selector */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Provider
              </label>
              <select
                value={llmProvider}
                onChange={(e) => saveLLMProvider(e.target.value as LLMProvider)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="ollama">Ollama (local)</option>
                <option value="anthropic">Anthropic (cloud)</option>
                <option value="apfel">Apfel (self-hosted)</option>
              </select>
            </div>

            {/* Ollama settings */}
            {llmProvider === "ollama" && (
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Model
                </label>
                <select
                  value={ollamaModel}
                  onChange={(e) => saveOllamaModel(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
            {llmProvider === "anthropic" && (
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  API Key
                </label>
                <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-500">
                  Get your API key from{" "}
                  <a
                    href="https://console.anthropic.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    console.anthropic.com
                  </a>
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={showApiKey ? settings.apiKey : getMaskedApiKey(settings.apiKey)}
                      onChange={(e) => saveSetting("apiKey", e.target.value)}
                      placeholder="sk-ant-..."
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                      readOnly={!showApiKey}
                    />
                  </div>
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    {showApiKey ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            )}

            {/* Apfel settings */}
            {llmProvider === "apfel" && (
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
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
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
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  />
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                    The model name configured on your Apfel server
                  </p>
                </div>
              </div>
            )}

            {/* Test connection */}
            <button
              onClick={testLLMConnection}
              disabled={llmTesting}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              {llmTesting ? "Testing..." : "Test Connection"}
            </button>
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
                    ankiConnected ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {ankiConnected ? "Connected" : "Not connected"}
                </span>
                <button
                  onClick={checkAnkiConnection}
                  disabled={ankiLoading}
                  className="ml-2 text-sm text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
                >
                  {ankiLoading ? "Checking..." : "Refresh"}
                </button>
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
                }}
                placeholder="http://localhost:8765"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
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
                  onChange={(e) => saveSetting("ankiDeckName", e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
                  onChange={(e) => saveSetting("ankiDeckName", e.target.value)}
                  placeholder="Deck name"
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
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
                  onChange={(e) => saveSetting("ankiClozeDeckName", e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
                  onChange={(e) => saveSetting("ankiClozeDeckName", e.target.value)}
                  placeholder="Cloze deck name"
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
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
                  onClick={() => saveSetting("defaultCardType", "basic")}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    settings.defaultCardType === "basic"
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                      : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  }`}
                >
                  Basic
                </button>
                <button
                  onClick={() => saveSetting("defaultCardType", "cloze")}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    settings.defaultCardType === "cloze"
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                      : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
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
                      googleTTSAvailable ? "bg-green-500" : "bg-yellow-500"
                    }`}
                  />
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {googleTTSAvailable ? "Google TTS Active" : "Using Browser TTS"}
                  </span>
                </div>
              )}
            </div>

            {/* Google Cloud API Key */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Google Cloud API Key
              </label>
              <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-500">
                For high-quality Afrikaans pronunciation. Get a key from{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  Google Cloud Console
                </a>
                {" "}(enable Text-to-Speech API).
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showGoogleApiKey ? "text" : "password"}
                    value={showGoogleApiKey ? settings.googleApiKey : getMaskedApiKey(settings.googleApiKey)}
                    onChange={(e) => saveSetting("googleApiKey", e.target.value)}
                    placeholder="AIza..."
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                    readOnly={!showGoogleApiKey}
                  />
                </div>
                <button
                  onClick={() => setShowGoogleApiKey(!showGoogleApiKey)}
                  className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  {showGoogleApiKey ? "Hide" : "Show"}
                </button>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Note: Set GOOGLE_CLOUD_API_KEY in your .env file for server-side use
              </p>
            </div>

            {/* TTS Mode Toggle */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Voice Engine
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => saveSetting("ttsMode", "google")}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    settings.ttsMode === "google"
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                      : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  }`}
                >
                  Google Cloud
                </button>
                <button
                  onClick={() => saveSetting("ttsMode", "browser")}
                  className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    settings.ttsMode === "browser"
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                      : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
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
                onClick={() => speak("Hallo, hoe gaan dit met jou?", settings.ttsSpeed)}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Test Voice
              </button>
            </div>

            {/* Speed Slider */}
            <div>
              <label className="mb-2 flex items-center justify-between text-sm font-medium text-zinc-700 dark:text-zinc-300">
                <span>Speech Speed</span>
                <span className="font-mono text-zinc-500">
                  {settings.ttsSpeed.toFixed(1)}x
                </span>
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={settings.ttsSpeed}
                onChange={(e) =>
                  saveSetting("ttsSpeed", parseFloat(e.target.value))
                }
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
                {(["light", "dark", "system"] as Theme[]).map((theme) => (
                  <button
                    key={theme}
                    onClick={() => saveSetting("theme", theme)}
                    className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium capitalize transition-colors ${
                      settings.theme === theme
                        ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                        : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    }`}
                  >
                    {theme}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Known Words Import Section */}
          <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Import Known Words
            </h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Import words you already know. Supports <strong>LingQ exports</strong> (with status levels and translations) or simple word lists.
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
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </div>

            <button
              onClick={handleTextImport}
              disabled={!importText.trim()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Import
            </button>

            {importStatus && (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                {importStatus}
              </p>
            )}
          </section>

          {/* Export Section */}
          <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Export Data
            </h2>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={exportVocabCSV}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Export Vocab (CSV)
              </button>
              <button
                onClick={exportVocabJSON}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Export Vocab (JSON)
              </button>
              <button
                onClick={exportKnownWords}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Export Known Words
              </button>
            </div>
            {exportStatus && (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                {exportStatus}
              </p>
            )}
          </section>

          {/* Data Management Section */}
          <section className="rounded-lg border border-red-200 bg-white p-6 dark:border-red-900/50 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Data Management
            </h2>

            <div className="mb-6 flex flex-wrap gap-3">
              <button
                onClick={exportFullBackup}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Export Full Backup
              </button>
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

            {/* Clear All Data */}
            <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <h3 className="mb-2 text-sm font-medium text-red-600 dark:text-red-400">
                Danger Zone
              </h3>
              {!showClearConfirm ? (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-zinc-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  Clear All Data
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    This will permanently delete all your books, vocabulary,
                    progress, and settings. Type{" "}
                    <span className="font-mono font-bold">DELETE ALL DATA</span>{" "}
                    to confirm.
                  </p>
                  <input
                    type="text"
                    value={clearConfirmText}
                    onChange={(e) => setCllearConfirmText(e.target.value)}
                    placeholder="DELETE ALL DATA"
                    className="w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 dark:border-red-800 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleClearAllData}
                      className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                      Confirm Delete
                    </button>
                    <button
                      onClick={() => {
                        setShowClearConfirm(false);
                        setCllearConfirmText("");
                      }}
                      className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
