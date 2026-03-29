"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import NavHeader from "@/components/NavHeader";
import VocabList from "@/components/VocabList";
import {
  type VocabEntry,
  type Book,
  type WordState,
  updateVocabState,
  getVocabStats,
  getAllVocab,
  getAllBooks,
  deleteVocabEntry,
  markVocabPushedToAnki,
} from "@/lib/data-layer";
import {
  addBasicCard,
  syncWordStates,
  isAnkiConnected,
  getDeckNames,
} from "@/lib/anki";

// Modal for viewing/editing a vocab entry
function VocabDetailModal({
  entry,
  onClose,
  onUpdate,
  onDelete,
}: {
  entry: VocabEntry;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<VocabEntry>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [translation, setTranslation] = useState(entry.translation);
  const [state, setState] = useState<WordState>(entry.state);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdate(entry.id, { translation, state });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this vocabulary entry?")) {
      return;
    }
    setIsDeleting(true);
    try {
      await onDelete(entry.id);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  // State color classes for dropdown
  const stateOptions: { value: WordState; label: string; color: string }[] = [
    { value: "new", label: "New", color: "bg-gray-200" },
    { value: "level1", label: "Level 1", color: "bg-blue-800" },
    { value: "level2", label: "Level 2", color: "bg-blue-600" },
    { value: "level3", label: "Level 3", color: "bg-blue-400" },
    { value: "level4", label: "Level 4", color: "bg-blue-200" },
    { value: "known", label: "Known", color: "bg-green-500" },
    { value: "ignored", label: "Ignored", color: "bg-gray-400" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {entry.text}
            </h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {entry.type === "phrase" ? "Phrase" : "Word"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {/* Translation */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Translation
            </label>
            {isEditing ? (
              <textarea
                value={translation}
                onChange={(e) => setTranslation(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                rows={2}
              />
            ) : (
              <p className="text-gray-900 dark:text-gray-100">
                {entry.translation}
              </p>
            )}
          </div>

          {/* Context Sentence */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Context Sentence
            </label>
            <p className="rounded-lg bg-gray-50 p-3 text-sm italic text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {entry.sentence}
            </p>
          </div>

          {/* State */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Learning State
            </label>
            {isEditing ? (
              <select
                value={state}
                onChange={(e) => setState(e.target.value as WordState)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                {stateOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full ${
                    stateOptions.find((o) => o.value === entry.state)?.color
                  }`}
                />
                <span className="text-gray-900 dark:text-gray-100">
                  {stateOptions.find((o) => o.value === entry.state)?.label}
                </span>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">Added: </span>
              <span className="text-gray-900 dark:text-gray-100">
                {new Date(entry.createdAt).toLocaleDateString("en-AU", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">
                Review Count:{" "}
              </span>
              <span className="text-gray-900 dark:text-gray-100">
                {entry.reviewCount}
              </span>
            </div>
            {entry.pushedToAnki && (
              <div className="col-span-2">
                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                  Synced to Anki
                  {entry.ankiNoteId && ` (Note #${entry.ankiNoteId})`}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-700">
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>

          <div className="flex gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setTranslation(entry.translation);
                    setState(entry.state);
                  }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Edit
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Stats summary component
function VocabStats({
  stats,
}: {
  stats: { total: number; byState: Record<WordState, number> };
}) {
  const learningCount =
    stats.byState.new +
    stats.byState.level1 +
    stats.byState.level2 +
    stats.byState.level3 +
    stats.byState.level4;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-lg bg-gray-100 p-3 dark:bg-gray-800">
        <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {stats.total}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          Total Words
        </div>
      </div>
      <div className="rounded-lg bg-blue-100 p-3 dark:bg-blue-900/30">
        <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
          {learningCount}
        </div>
        <div className="text-sm text-blue-600 dark:text-blue-400">Learning</div>
      </div>
      <div className="rounded-lg bg-green-100 p-3 dark:bg-green-900/30">
        <div className="text-2xl font-bold text-green-700 dark:text-green-400">
          {stats.byState.known}
        </div>
        <div className="text-sm text-green-600 dark:text-green-400">Known</div>
      </div>
      <div className="rounded-lg bg-gray-100 p-3 dark:bg-gray-800">
        <div className="text-2xl font-bold text-gray-500 dark:text-gray-500">
          {stats.byState.ignored}
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-500">Ignored</div>
      </div>
    </div>
  );
}

export default function VocabPage() {
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    byState: Record<WordState, number>;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<VocabEntry | null>(null);
  const [ankiConnected, setAnkiConnected] = useState<boolean | null>(null);
  const [ankiDeck, setAnkiDeck] = useState("Afrikaans");
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Load data on mount
  useEffect(() => {
    loadData();
    checkAnkiConnection();
    // Load deck name from settings
    const savedDeck = localStorage.getItem("afrikaans-reader-anki-deck");
    if (savedDeck) {
      setAnkiDeck(savedDeck);
    }
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [vocabData, booksData, statsData] = await Promise.all([
        getAllVocab(),
        getAllBooks(),
        getVocabStats(),
      ]);
      setEntries(vocabData);
      setBooks(booksData);
      setStats(statsData);
    } catch (error) {
      console.error("Failed to load data:", error);
      showNotification("error", "Failed to load vocabulary data");
    } finally {
      setIsLoading(false);
    }
  };

  const checkAnkiConnection = async () => {
    try {
      const connected = await isAnkiConnected();
      setAnkiConnected(connected);
      if (connected) {
        const decks = await getDeckNames();
        // Only auto-select a deck if the user hasn't saved a preference
        const savedDeck = localStorage.getItem("afrikaans-reader-anki-deck");
        if (!savedDeck) {
          const afrikaansDeck = decks.find((d) =>
            d.toLowerCase().includes("afrikaans")
          );
          if (afrikaansDeck) {
            setAnkiDeck(afrikaansDeck);
          } else if (decks.length > 0 && decks[0] !== "Default") {
            setAnkiDeck(decks[0]);
          }
        }
      }
    } catch {
      setAnkiConnected(false);
    }
  };

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  // Handle entry click to view/edit
  const handleEntryClick = (entry: VocabEntry) => {
    setSelectedEntry(entry);
  };

  // Update entry
  const handleUpdateEntry = async (
    id: string,
    updates: Partial<VocabEntry>
  ) => {
    try {
      // Use updateVocabState for state changes, or a general update API call
      if (updates.state) {
        await updateVocabState(id, updates.state);
      }
      // For other updates, we'd need an update endpoint - for now just reload
      await loadData();
      // Update selected entry if it's the one being edited
      if (selectedEntry?.id === id) {
        setSelectedEntry((prev) => (prev ? { ...prev, ...updates } : null));
      }
      showNotification("success", "Entry updated successfully");
    } catch (error) {
      console.error("Failed to update entry:", error);
      showNotification("error", "Failed to update entry");
      throw error;
    }
  };

  // Delete entry
  const handleDeleteEntry = async (id: string) => {
    try {
      await deleteVocabEntry(id);
      await loadData();
      showNotification("success", "Entry deleted");
    } catch (error) {
      console.error("Failed to delete entry:", error);
      showNotification("error", "Failed to delete entry");
      throw error;
    }
  };

  // Export selected entries to Anki
  const handleExportToAnki = useCallback(
    async (ids: string[]) => {
      if (!ankiConnected) {
        showNotification(
          "error",
          "Anki is not connected. Make sure Anki is running with AnkiConnect."
        );
        return;
      }

      const entriesToExport = entries.filter(
        (e) => ids.includes(e.id) && !e.pushedToAnki
      );
      if (entriesToExport.length === 0) {
        showNotification(
          "error",
          "All selected entries have already been synced to Anki."
        );
        return;
      }

      let successCount = 0;
      let errorCount = 0;

      for (const entry of entriesToExport) {
        try {
          const noteId = await addBasicCard(
            ankiDeck,
            entry.sentence,
            entry.text,
            entry.translation,
            entry.translation // word meaning - using translation for now
          );
          await markVocabPushedToAnki(entry.id, noteId);
          successCount++;
        } catch (error) {
          console.error(`Failed to export "${entry.text}":`, error);
          errorCount++;
        }
      }

      await loadData();

      if (errorCount === 0) {
        showNotification(
          "success",
          `Successfully exported ${successCount} cards to Anki`
        );
      } else {
        showNotification(
          "error",
          `Exported ${successCount} cards, ${errorCount} failed`
        );
      }
    },
    [entries, ankiConnected, ankiDeck]
  );

  // Mark selected entries as known
  const handleMarkAsKnown = useCallback(
    async (ids: string[]) => {
      try {
        for (const id of ids) {
          await updateVocabState(id, "known");
        }
        await loadData();
        showNotification(
          "success",
          `Marked ${ids.length} entries as known`
        );
      } catch (error) {
        console.error("Failed to mark as known:", error);
        showNotification("error", "Failed to mark entries as known");
      }
    },
    []
  );

  // Sync with Anki to update mastery levels
  const handleSyncWithAnki = useCallback(async () => {
    if (!ankiConnected) {
      showNotification(
        "error",
        "Anki is not connected. Make sure Anki is running with AnkiConnect."
      );
      return;
    }

    try {
      // Get deck name from settings
      const deckName = localStorage.getItem("afrikaans-reader-anki-deck") || ankiDeck;
      console.log(`Syncing with Anki deck: "${deckName}"`);
      const wordStates = await syncWordStates(deckName);
      console.log(`Found ${wordStates.size} words in Anki`);
      let updatedCount = 0;
      let matchedCount = 0;

      // Update entries based on Anki intervals
      for (const entry of entries) {
        const ankiData = wordStates.get(entry.text.toLowerCase());
        if (ankiData) {
          matchedCount++;
          // Map interval to state:
          // 0-1 days: level1
          // 2-7 days: level2
          // 8-14 days: level3
          // 15-30 days: level4
          // 31+ days: known
          let newState: WordState = entry.state;
          if (ankiData.interval >= 31) {
            newState = "known";
          } else if (ankiData.interval >= 15) {
            newState = "level4";
          } else if (ankiData.interval >= 8) {
            newState = "level3";
          } else if (ankiData.interval >= 2) {
            newState = "level2";
          } else if (ankiData.interval >= 0) {
            newState = "level1";
          }

          if (newState !== entry.state) {
            await updateVocabState(entry.id, newState);
            updatedCount++;
          }
        }
      }

      await loadData();
      showNotification(
        "success",
        `Found ${wordStates.size} cards in "${deckName}". Matched ${matchedCount} vocab entries, updated ${updatedCount}.`
      );
    } catch (error) {
      console.error("Failed to sync with Anki:", error);
      showNotification("error", "Failed to sync with Anki");
    }
  }, [entries, ankiConnected, ankiDeck]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 sm:ml-56">
      <NavHeader />
      {/* Header — mobile only, desktop uses sidebar */}
      <header className="sm:hidden border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
              </Link>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Vocabulary
              </h1>
            </div>

            {/* Anki connection status */}
            <div className="flex items-center gap-2">
              {ankiConnected === null ? (
                <span className="text-sm text-gray-500">
                  Checking Anki connection...
                </span>
              ) : ankiConnected ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  Anki Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-800 dark:bg-red-900 dark:text-red-200">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  Anki Disconnected
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Notification */}
      {notification && (
        <div
          className={`fixed right-4 top-4 z-50 rounded-lg px-4 py-3 shadow-lg ${
            notification.type === "success"
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === "success" ? (
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            ) : (
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            )}
            <span>{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              className="ml-2 hover:opacity-70"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Stats */}
        {stats && (
          <div className="mb-6">
            <VocabStats stats={stats} />
          </div>
        )}

        {/* Vocabulary List - exclude ignored words */}
        <VocabList
          entries={entries.filter(e => e.state !== 'ignored')}
          books={books}
          onEntryClick={handleEntryClick}
          onExportToAnki={handleExportToAnki}
          onMarkAsKnown={handleMarkAsKnown}
          onSyncWithAnki={handleSyncWithAnki}
          isLoading={isLoading}
        />
      </main>

      {/* Detail Modal */}
      {selectedEntry && (
        <VocabDetailModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onUpdate={handleUpdateEntry}
          onDelete={handleDeleteEntry}
        />
      )}
    </div>
  );
}
