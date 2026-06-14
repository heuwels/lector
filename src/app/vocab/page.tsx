'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { toast } from 'sonner';
import PageHeader from '@/components/PageHeader';

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
      toast.error('Failed to load vocabulary data', {
        duration: 2000,
      });
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
      toast.success('Entry updated successfully', {
        duration: 5000,
      });
    } catch (error) {
      console.error('Failed to update entry:', error);
      toast.error('Failed to update entry', {
        duration: 5000,
      });
      throw error;
    }
  };

  // Delete entry
  const handleDeleteEntry = async (id: string) => {
    try {
      await deleteVocabEntry(id);
      await loadData();
      toast.success('Entry deleted', {
        duration: 5000,
      });
    } catch (error) {
      console.error('Failed to delete entry:', error);
      toast.error('Failed to delete entry', {
        duration: 5000,
      });
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
        toast.error('Anki is not connected. Make sure Anki is running with AnkiConnect.', {
          duration: 5000,
        });
        return;
      }

      const entriesToExport = entries.filter((e) => ids.includes(e.id) && !e.pushedToAnki);
      if (entriesToExport.length === 0) {
        toast.error('All selected entries have already been synced to Anki.', {
          duration: 5000,
        });
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
        toast.success(
          `Exported ${successCount} ${cardLabel} card${successCount === 1 ? '' : 's'} to "${targetDeck}"`,
          {
            duration: 5000,
          },
        );
      } else {
        toast.error(`Exported ${successCount} ${cardLabel} cards, ${errorCount} failed`, {
          duration: 5000,
        });
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
      toast.success(`Marked ${ids.length} entries as known`, {
        duration: 5000,
      });
    } catch (error) {
      console.error('Failed to mark as known:', error);
      toast.error('Failed to mark entries as known', {
        duration: 5000,
      });
    }
  }, []);

  // Sync with Anki to update mastery levels
  const handleSyncWithAnki = useCallback(async () => {
    if (!ankiConnected) {
      toast.error('Anki is not connected. Make sure Anki is running with AnkiConnect.', {
        duration: 5000,
      });
      return;
    }

    try {
      // Get deck name from settings
      const deckName = localStorage.getItem('lector-anki-deck') || ankiDeck;
      const wordStates = await syncWordStates(deckName);
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
      toast.success(
        `Found ${wordStates.size} cards in "${deckName}". Matched ${matchedCount} vocab entries, updated ${updatedCount}.`,
        {
          duration: 5000,
        },
      );
    } catch (error) {
      console.error('Failed to sync with Anki:', error);
      toast.error('Failed to sync with Anki', {
        duration: 5000,
      });
    }
  }, [entries, ankiConnected, ankiDeck]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Vocabulary">
        <div className="flex items-center gap-2">
          {ankiConnected === null ? (
            <span className="text-sm text-muted-foreground">Checking Anki connection...</span>
          ) : ankiConnected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] px-3 py-1 text-sm font-medium text-primary">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Anki Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] px-3 py-1 text-sm font-medium text-destructive">
              <span className="h-2 w-2 rounded-full bg-destructive" />
              Anki Disconnected
            </span>
          )}
        </div>
      </PageHeader>
      {stats && (
        <div className="mb-6">
          <VocabStats stats={stats} />
        </div>
      )}
      <VocabList
        entries={entries.filter((e) => e.state !== 'ignored')}
        collections={collections}
        onEntryClick={handleEntryClick}
        onExportToAnki={handleExportToAnki}
        onMarkAsKnown={handleMarkAsKnown}
        onSyncWithAnki={handleSyncWithAnki}
        isLoading={isLoading}
      />
      {selectedEntry && (
        <VocabDetailModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onUpdate={handleUpdateEntry}
          onDelete={handleDeleteEntry}
        />
      )}
    </main>
  );
}
