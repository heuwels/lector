'use client';

import { useState, useEffect, useCallback } from 'react';
import VocabList from '@/components/VocabList';
import {
  type VocabEntry,
  type Collection,
  type WordState,
  updateVocabState,
  getAllVocab,
  getAllCollections,
  deleteVocabEntry,
  markVocabPushedToAnki,
  saveVocab,
} from '@/lib/data-layer';
import {
  addBasicCard,
  addClozeCard,
  syncWordStates,
  reconcileAnkiStates,
  findNewAnkiWords,
  isAnkiConnected,
  getDeckNames,
} from '@/lib/anki';
import { queueForAnki } from '@/lib/anki-queue';
import { useAnkiTransport } from '@/lib/anki-transport';
import VocabStats from './components/VocabStats';
import VocabDetailModal from './components/VocabDetailModal';
import { toast } from 'sonner';
import PageHeader from '@/components/PageHeader';
import { useActiveLanguage } from '@/utils/hooks';

export default function VocabPage() {
  const activeLang = useActiveLanguage();
  const ankiTransport = useAnkiTransport();
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    byState: Record<WordState, number>;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<VocabEntry | null>(null);
  const [ankiConnected, setAnkiConnected] = useState<boolean | null>(null);
  const [ankiDeck, setAnkiDeck] = useState(activeLang.native);
  const [ankiClozeDeck, setAnkiClozeDeck] = useState(`${activeLang.native}::Cloze`);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // Probe AnkiConnect only on the browser-direct transport (#241): on
    // 'addon' (cloud always; selfhost by choice) export goes through the
    // server-side queue, so there is no localhost connection to check — and
    // from a hosted page the probe is blocked by Local Network Access anyway.
    if (ankiTransport !== 'ankiconnect') return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ankiTransport]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [vocabData, collectionsData] = await Promise.all([
        getAllVocab(),
        getAllCollections(),
      ]);
      setEntries(vocabData);
      setCollections(collectionsData);
      // Derive the state breakdown from the list we already fetched — this was
      // a second identical full-list fetch via getVocabStats (#240).
      const byState: Record<WordState, number> = {
        new: 0, level1: 0, level2: 0, level3: 0, level4: 0, known: 0, ignored: 0,
      };
      vocabData.forEach((v) => { byState[v.state]++; });
      setStats({ total: vocabData.length, byState });
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
          const langNative = activeLang.native.toLowerCase();
          const langName = activeLang.name.toLowerCase();
          const matchedDeck = decks.find((d) => {
            const dl = d.toLowerCase();
            return dl.includes(langNative) || dl.includes(langName);
          });
          if (matchedDeck) {
            setAnkiDeck(matchedDeck);
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
      const entriesToExport = entries.filter((e) => ids.includes(e.id) && !e.pushedToAnki);
      if (entriesToExport.length === 0) {
        toast.error('All selected entries have already been synced to Anki.', {
          duration: 5000,
        });
        return;
      }

      // Addon transport (#241): no browser→AnkiConnect — queue server-side;
      // the Lector addon creates the notes on Anki's next sync and acks them
      // (which is what flips pushedToAnki, so entries stay exportable until
      // then).
      if (ankiTransport === 'addon') {
        try {
          const result = await queueForAnki(
            entriesToExport.map((e) => ({ id: e.id, cardType })),
          );
          if (result.failed.length > 0) {
            toast.error(
              `Queued ${result.queued} card${result.queued === 1 ? '' : 's'}, ${result.failed.length} failed (${result.failed[0].error})`,
              { duration: 5000 },
            );
          } else {
            toast.success(
              `Queued ${result.queued} ${cardType} card${result.queued === 1 ? '' : 's'} — they'll appear next time Anki syncs`,
              { duration: 5000 },
            );
          }
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Failed to queue cards for Anki', {
            duration: 5000,
          });
        }
        return;
      }

      if (!ankiConnected) {
        toast.error('Anki is not connected. Make sure Anki is running with AnkiConnect.', {
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
    [entries, ankiTransport, ankiConnected, ankiDeck, ankiClozeDeck],
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

  // Pull Anki card states, upgrade matching vocab entries, and create new
  // entries for Anki words that have never been saved to lector.
  //
  // Anki card → lector state mapping (see ankiCardToState):
  //   New (type 0)              → skipped (queued but not yet studied)
  //   Learning (type 1)         → level1
  //   Relearning (type 3)       → level2
  //   Young (type 2, < 21 d)    → level4
  //   Mature (type 2, ≥ 21 d)   → known
  const handleSyncWithAnki = useCallback(async () => {
    if (!ankiConnected) {
      toast.error('Anki is not connected. Make sure Anki is running with AnkiConnect.', {
        duration: 5000,
      });
      return;
    }

    try {
      // Scoped to lector-tagged cards only (see syncWordStates) — the deck
      // configuration is used for exporting, not for back-sync.
      const ankiStates = await syncWordStates();

      // Upgrade existing entries.
      const upgrades = reconcileAnkiStates(entries, ankiStates);
      for (const { id, newState } of upgrades) {
        await updateVocabState(id, newState);
      }

      // Create vocab entries for Anki words not yet in lector.
      const now = new Date();
      const newWords = findNewAnkiWords(entries, ankiStates);
      for (const { text, state, sentence, translation } of newWords) {
        await saveVocab({
          id: crypto.randomUUID(),
          text,
          type: 'word',
          sentence,
          translation,
          state,
          stateUpdatedAt: now,
          reviewCount: 0,
          createdAt: now,
          pushedToAnki: true,
        });
      }

      await loadData();

      // Always surface the upgrade count (even 0) so a no-op sync still reads
      // clearly; only mention imports when some words were actually created.
      const parts = [`upgraded ${upgrades.length}`];
      if (newWords.length) parts.push(`imported ${newWords.length} from Anki`);
      const cardCount = ankiStates.size;
      toast.success(
        `Synced ${cardCount} Anki card${cardCount === 1 ? '' : 's'} — ${parts.join(', ')}.`,
        { duration: 5000 },
      );
    } catch (error) {
      console.error('Failed to sync with Anki:', error);
      toast.error('Failed to sync with Anki', { duration: 5000 });
    }
  }, [entries, ankiConnected]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Vocabulary">
        <div className="flex items-center gap-2">
          {ankiTransport === 'addon' ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] px-3 py-1 text-sm font-medium text-primary"
              data-testid="anki-addon-pill"
            >
              <span className="h-2 w-2 rounded-full bg-primary" />
              Anki syncs via add-on
            </span>
          ) : ankiConnected === null ? (
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
        // Pull-sync is the browser→AnkiConnect path; on the addon transport
        // review state pushes itself, so the button would be a dead end.
        onSyncWithAnki={ankiTransport === 'addon' ? undefined : handleSyncWithAnki}
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
