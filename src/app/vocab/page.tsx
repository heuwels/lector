'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, X } from 'lucide-react';
import NavHeader from '@/components/NavHeader';
import VocabList from '@/components/VocabList';
import {
  type VocabEntry,
  type Collection,
  type WordState,
  updateVocabState,
  getVocabStats,
  getAllVocab,
  getAllCollections,
  deleteVocabEntry,
  markVocabPushedToAnki,
} from '@/lib/data-layer';
import {
  addBasicCard,
  addClozeCard,
  syncWordStates,
  isAnkiConnected,
  getDeckNames,
} from '@/lib/anki';
import VocabStats from './components/VocabStats';
import VocabDetailModal from './components/VocabDetailModal';

export default function VocabPage() {
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    byState: Record<WordState, number>;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<VocabEntry | null>(null);
  const [ankiConnected, setAnkiConnected] = useState<boolean | null>(null);
  const [ankiDeck, setAnkiDeck] = useState('Afrikaans');
  const [ankiClozeDeck, setAnkiClozeDeck] = useState('Afrikaans::Cloze');
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    loadData();
    checkAnkiConnection();
    // Load deck names from settings — match the keys the settings page writes
    const savedDeck = localStorage.getItem('lector-anki-deck');
    if (savedDeck) {
      setAnkiDeck(savedDeck);
    }
    const savedClozeDeck = localStorage.getItem('lector-anki-cloze-deck');
    if (savedClozeDeck) {
      setAnkiClozeDeck(savedClozeDeck);
    }
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [vocabData, collectionsData, statsData] = await Promise.all([
        getAllVocab(),
        getAllCollections(),
        getVocabStats(),
      ]);
      setEntries(vocabData);
      setCollections(collectionsData);
      setStats(statsData);
    } catch (error) {
      console.error('Failed to load data:', error);
      showNotification('error', 'Failed to load vocabulary data');
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
        const savedDeck = localStorage.getItem('lector-anki-deck');
        if (!savedDeck) {
          const afrikaansDeck = decks.find((d) => d.toLowerCase().includes('afrikaans'));
          if (afrikaansDeck) {
            setAnkiDeck(afrikaansDeck);
          } else if (decks.length > 0 && decks[0] !== 'Default') {
            setAnkiDeck(decks[0]);
          }
        }
      }
    } catch {
      setAnkiConnected(false);
    }
  };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  // Handle entry click to view/edit
  const handleEntryClick = (entry: VocabEntry) => {
    setSelectedEntry(entry);
  };

  // Update entry
  const handleUpdateEntry = async (id: string, updates: Partial<VocabEntry>) => {
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
      showNotification('success', 'Entry updated successfully');
    } catch (error) {
      console.error('Failed to update entry:', error);
      showNotification('error', 'Failed to update entry');
      throw error;
    }
  };

  // Delete entry
  const handleDeleteEntry = async (id: string) => {
    try {
      await deleteVocabEntry(id);
      await loadData();
      showNotification('success', 'Entry deleted');
    } catch (error) {
      console.error('Failed to delete entry:', error);
      showNotification('error', 'Failed to delete entry');
      throw error;
    }
  };

  // Export selected entries to Anki. cardType controls which Anki model
  // (and which deck) is used — Basic front/back cards go to the user's
  // configured Basic deck (ankiDeck); Cloze deletions go to the Cloze deck
  // (ankiClozeDeck). The choice is made via the toggle in VocabList.
  const handleExportToAnki = useCallback(
    async (ids: string[], cardType: 'basic' | 'cloze') => {
      if (!ankiConnected) {
        showNotification(
          'error',
          'Anki is not connected. Make sure Anki is running with AnkiConnect.',
        );
        return;
      }

      const entriesToExport = entries.filter((e) => ids.includes(e.id) && !e.pushedToAnki);
      if (entriesToExport.length === 0) {
        showNotification('error', 'All selected entries have already been synced to Anki.');
        return;
      }

      const targetDeck = cardType === 'cloze' ? ankiClozeDeck : ankiDeck;
      const addCard = cardType === 'cloze' ? addClozeCard : addBasicCard;
      const cardLabel = cardType === 'cloze' ? 'cloze' : 'basic';

      let successCount = 0;
      let errorCount = 0;

      for (const entry of entriesToExport) {
        try {
          const noteId = await addCard(
            targetDeck,
            entry.sentence,
            entry.text,
            entry.translation,
            entry.translation, // word meaning — using translation for now
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
          'success',
          `Exported ${successCount} ${cardLabel} card${successCount === 1 ? '' : 's'} to "${targetDeck}"`,
        );
      } else {
        showNotification(
          'error',
          `Exported ${successCount} ${cardLabel} cards, ${errorCount} failed`,
        );
      }
    },
    [entries, ankiConnected, ankiDeck, ankiClozeDeck],
  );

  // Mark selected entries as known
  const handleMarkAsKnown = useCallback(async (ids: string[]) => {
    try {
      for (const id of ids) {
        await updateVocabState(id, 'known');
      }
      await loadData();
      showNotification('success', `Marked ${ids.length} entries as known`);
    } catch (error) {
      console.error('Failed to mark as known:', error);
      showNotification('error', 'Failed to mark entries as known');
    }
  }, []);

  // Sync with Anki to update mastery levels
  const handleSyncWithAnki = useCallback(async () => {
    if (!ankiConnected) {
      showNotification(
        'error',
        'Anki is not connected. Make sure Anki is running with AnkiConnect.',
      );
      return;
    }

    try {
      // Get deck name from settings
      const deckName = localStorage.getItem('lector-anki-deck') || ankiDeck;
      console.log(`Syncing with Anki deck: "${deckName}"`);
      const wordStates = await syncWordStates(deckName);
      console.log(`Found ${wordStates.size} words in Anki`);
      let updatedCount = 0;
      let matchedCount = 0;

      // Update entries based on Anki intervals. Sync only ever *upgrades* a
      // state (issue #108): a freshly-exported card has interval 0 and must
      // not demote a word the user already marked known.
      const stateRank: Record<WordState, number> = {
        new: 0,
        level1: 1,
        level2: 2,
        level3: 3,
        level4: 4,
        known: 5,
        ignored: 5, // never overridden by sync
      };

      for (const entry of entries) {
        const ankiData = wordStates.get(entry.text.toLowerCase());
        if (ankiData) {
          matchedCount++;
          if (entry.state === 'ignored') continue;
          // New/relearning cards (interval < 1 day) carry no signal yet.
          if (ankiData.interval < 1) continue;

          // Map interval to state:
          // 1 day: level1
          // 2-7 days: level2
          // 8-14 days: level3
          // 15-30 days: level4
          // 31+ days: known
          let newState: WordState;
          if (ankiData.interval >= 31) {
            newState = 'known';
          } else if (ankiData.interval >= 15) {
            newState = 'level4';
          } else if (ankiData.interval >= 8) {
            newState = 'level3';
          } else if (ankiData.interval >= 2) {
            newState = 'level2';
          } else {
            newState = 'level1';
          }

          if (stateRank[newState] > stateRank[entry.state]) {
            await updateVocabState(entry.id, newState);
            updatedCount++;
          }
        }
      }

      await loadData();
      showNotification(
        'success',
        `Found ${wordStates.size} cards in "${deckName}". Matched ${matchedCount} vocab entries, updated ${updatedCount}.`,
      );
    } catch (error) {
      console.error('Failed to sync with Anki:', error);
      showNotification('error', 'Failed to sync with Anki');
    }
  }, [entries, ankiConnected, ankiDeck]);

  return (
    <div className="min-h-screen bg-gray-50 pt-[var(--mobile-topbar-h)] sm:ml-56 sm:pt-0 dark:bg-gray-950">
      <NavHeader />
      {/* Header — mobile only, desktop uses sidebar */}
      <header className="border-b border-gray-200 bg-white sm:hidden dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <ArrowLeft className="h-6 w-6" />
              </Link>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Vocabulary</h1>
            </div>

            {/* Anki connection status */}
            <div className="flex items-center gap-2">
              {ankiConnected === null ? (
                <span className="text-sm text-gray-500">Checking Anki connection...</span>
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
          className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-3 shadow-lg ${
            notification.type === 'success'
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <Check className="h-5 w-5" />
            ) : (
              <X className="h-5 w-5" />
            )}
            <span>{notification.message}</span>
            <button onClick={() => setNotification(null)} className="ml-2 hover:opacity-70">
              <X className="h-4 w-4" />
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
          entries={entries.filter((e) => e.state !== 'ignored')}
          collections={collections}
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
