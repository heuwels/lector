'use client';

import { Check, ChevronDown, ChevronUp, Loader2, RefreshCw, Upload } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';
import type { WordState } from '@/lib/data-layer';
import VocabRow from './components/VocabRow';
import { stateFilters, stateOrder } from './constants';
import { AnkiCardType, SortDirection, SortField, VocabListProps } from './types';
import { Button } from '../ui/button';

export default function VocabList({
  entries,
  collections,
  onEntryClick,
  onExportToAnki,
  onMarkAsKnown,
  onSyncWithAnki,
  isLoading = false,
}: VocabListProps) {
  // Filter state
  const [stateFilter, setStateFilter] = useState<WordState | 'all' | 'learning'>('all');
  const [bookFilter, setBookFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Sort state
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Action loading states
  const [isExporting, setIsExporting] = useState(false);
  const [isMarkingKnown, setIsMarkingKnown] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Export-to-Anki modal state. Card type pre-selects the user's last choice
  // (persisted to localStorage) so heavy Cloze users don't flip on every open.
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [cardType, setCardType] = useState<AnkiCardType>(() => {
    if (typeof window === 'undefined') return 'basic';
    const saved = localStorage.getItem('lector-anki-card-type');
    return saved === 'cloze' ? 'cloze' : 'basic';
  });
  const updateCardType = (next: AnkiCardType) => {
    setCardType(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('lector-anki-card-type', next);
    }
  };

  // Create a map of collectionId to title for display
  const bookTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    collections.forEach((c) => map.set(c.id, c.title));
    return map;
  }, [collections]);

  // Filter and sort entries
  const filteredEntries = useMemo(() => {
    let result = [...entries];

    // Apply state filter
    if (stateFilter !== 'all') {
      if (stateFilter === 'learning') {
        // "Learning" includes new, level1-4 (not known or ignored)
        result = result.filter((e) => e.state !== 'known' && e.state !== 'ignored');
      } else {
        result = result.filter((e) => e.state === stateFilter);
      }
    }

    // Apply book filter
    if (bookFilter !== 'all') {
      result = result.filter((e) => e.bookId === bookFilter);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(
        (e) =>
          e.text.toLowerCase().includes(query) ||
          e.translation.toLowerCase().includes(query) ||
          e.sentence.toLowerCase().includes(query),
      );
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'text':
          comparison = a.text.localeCompare(b.text);
          break;
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'state':
          comparison = stateOrder[a.state] - stateOrder[b.state];
          break;
        case 'bookId':
          const titleA = a.bookId ? bookTitleMap.get(a.bookId) || '' : '';
          const titleB = b.bookId ? bookTitleMap.get(b.bookId) || '' : '';
          comparison = titleA.localeCompare(titleB);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [entries, stateFilter, bookFilter, searchQuery, sortField, sortDirection, bookTitleMap]);

  // Handle selection
  const handleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (selected) {
        newSet.add(id);
      } else {
        newSet.delete(id);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = useCallback(
    (selected: boolean) => {
      if (selected) {
        setSelectedIds(new Set(filteredEntries.map((e) => e.id)));
      } else {
        setSelectedIds(new Set());
      }
    },
    [filteredEntries],
  );

  // Handle sort column click
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Sort indicator component
  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return (
      <span className="ml-1">
        {sortDirection === 'asc' ? (
          <ChevronUp className="inline h-4 w-4" />
        ) : (
          <ChevronDown className="inline h-4 w-4" />
        )}
      </span>
    );
  };

  // Bulk action handlers. The export button opens a modal that confirms the
  // card type; the actual onExportToAnki call fires from the modal's Export
  // action so the user has a moment to switch Basic <-> Cloze.
  const openExportModal = () => {
    if (selectedIds.size === 0) return;
    setExportModalOpen(true);
  };
  const confirmExportToAnki = async () => {
    setExportModalOpen(false);
    setIsExporting(true);
    try {
      await onExportToAnki(Array.from(selectedIds), cardType);
      setSelectedIds(new Set());
    } finally {
      setIsExporting(false);
    }
  };

  const handleMarkAsKnown = async () => {
    if (selectedIds.size === 0) return;
    setIsMarkingKnown(true);
    try {
      await onMarkAsKnown(Array.from(selectedIds));
      setSelectedIds(new Set());
    } finally {
      setIsMarkingKnown(false);
    }
  };

  const handleSyncWithAnki = async () => {
    setIsSyncing(true);
    try {
      await onSyncWithAnki();
    } finally {
      setIsSyncing(false);
    }
  };

  const allSelected =
    filteredEntries.length > 0 && filteredEntries.every((e) => selectedIds.has(e.id));
  const someSelected = selectedIds.size > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Filters and Search */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Search */}
        <div className="min-w-[200px] flex-1">
          <input
            type="text"
            placeholder="Search words, translations, or sentences..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
          />
        </div>

        {/* State Filter */}
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as WordState | 'all' | 'learning')}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
        >
          {stateFilters.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>

        {/* Book Filter */}
        <select
          value={bookFilter}
          onChange={(e) => setBookFilter(e.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
        >
          <option value="all">All Collections</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>

      {/* Bulk Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={openExportModal} disabled={!someSelected || isExporting}>
          {isExporting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Export to Anki ({selectedIds.size})
            </>
          )}
        </Button>

        <Button onClick={handleMarkAsKnown} disabled={!someSelected || isMarkingKnown}>
          {isMarkingKnown ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Updating...
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Mark as Known ({selectedIds.size})
            </>
          )}
        </Button>

        <div className="flex-1" />

        <Button onClick={handleSyncWithAnki} disabled={isSyncing}>
          {isSyncing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              Sync with Anki
            </>
          )}
        </Button>
      </div>

      {/* Results count */}
      <div className="text-sm text-muted-foreground">
        Showing {filteredEntries.length} of {entries.length} entries
        {someSelected && ` (${selectedIds.size} selected)`}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left">
          <thead className="bg-muted">
            <tr>
              <th className="w-12 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground hover:text-foreground"
                onClick={() => handleSort('text')}
              >
                Word/Phrase
                <SortIndicator field="text" />
              </th>
              <th className="px-4 py-3 text-sm font-semibold text-foreground">
                Translation
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-center text-sm font-semibold text-foreground hover:text-foreground"
                onClick={() => handleSort('state')}
              >
                State
                <SortIndicator field="state" />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground hover:text-foreground"
                onClick={() => handleSort('bookId')}
              >
                Source
                <SortIndicator field="bookId" />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground hover:text-foreground"
                onClick={() => handleSort('createdAt')}
              >
                Date Added
                <SortIndicator field="createdAt" />
              </th>
              <th className="px-4 py-3 text-sm font-semibold text-foreground">
                Anki
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-muted-foreground">Loading vocabulary...</span>
                  </div>
                </td>
              </tr>
            ) : filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  {entries.length === 0
                    ? 'No vocabulary entries yet. Start reading to add words!'
                    : 'No entries match your filters.'}
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry) => (
                <VocabRow
                  key={entry.id}
                  entry={entry}
                  bookTitle={entry.bookId ? bookTitleMap.get(entry.bookId) : undefined}
                  isSelected={selectedIds.has(entry.id)}
                  onSelect={handleSelect}
                  onClick={onEntryClick}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Export-to-Anki modal */}
      {exportModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setExportModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Export to Anki"
        >
          <div
            className="w-full max-w-md rounded-xl bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-semibold text-foreground">
              Export to Anki
            </h2>
            <p className="mb-5 text-sm text-muted-foreground">
              {selectedIds.size} {selectedIds.size === 1 ? 'word' : 'words'} selected. Choose a card
              type.
            </p>

            <div className="mb-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                data-testid="anki-card-type-basic"
                aria-pressed={cardType === 'basic'}
                onClick={() => updateCardType('basic')}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  cardType === 'basic'
                    ? 'border-primary bg-[var(--primary-soft)] ring-2 ring-primary'
                    : 'border-border hover:border-foreground/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">Basic</span>
                  {cardType === 'basic' && (
                    <Check className="h-4 w-4 text-primary" strokeWidth={3} />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Front/back card. Sentence on front, translation on back.
                </p>
              </button>

              <button
                type="button"
                data-testid="anki-card-type-cloze"
                aria-pressed={cardType === 'cloze'}
                onClick={() => updateCardType('cloze')}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  cardType === 'cloze'
                    ? 'border-primary bg-[var(--primary-soft)] ring-2 ring-primary'
                    : 'border-border hover:border-foreground/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">Cloze</span>
                  {cardType === 'cloze' && (
                    <Check className="h-4 w-4 text-primary" strokeWidth={3} />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Word is hidden in the sentence; recall it from context.
                </p>
              </button>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setExportModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                data-testid="anki-export-confirm"
                onClick={confirmExportToAnki}
              >
                Export {selectedIds.size} {selectedIds.size === 1 ? 'card' : 'cards'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
