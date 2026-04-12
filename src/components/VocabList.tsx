"use client";

import { useState, useMemo, useCallback } from "react";
import VocabRow from "./VocabRow";
import { type VocabEntry, type WordState, type Collection } from "@/lib/data-layer";

// Sort field options
type SortField = "text" | "createdAt" | "state" | "bookId";
type SortDirection = "asc" | "desc";

interface VocabListProps {
  entries: VocabEntry[];
  collections: Collection[];
  onEntryClick: (entry: VocabEntry) => void;
  onExportToAnki: (ids: string[]) => Promise<void>;
  onMarkAsKnown: (ids: string[]) => Promise<void>;
  onSyncWithAnki: () => Promise<void>;
  isLoading?: boolean;
}

// State filter options
const stateFilters: { value: WordState | "all" | "learning"; label: string }[] =
  [
    { value: "all", label: "All" },
    { value: "learning", label: "Learning" },
    { value: "new", label: "New" },
    { value: "level1", label: "Level 1" },
    { value: "level2", label: "Level 2" },
    { value: "level3", label: "Level 3" },
    { value: "level4", label: "Level 4" },
    { value: "known", label: "Known" },
    { value: "ignored", label: "Ignored" },
  ];

// State sort order for sorting
const stateOrder: Record<WordState, number> = {
  new: 0,
  level1: 1,
  level2: 2,
  level3: 3,
  level4: 4,
  known: 5,
  ignored: 6,
};

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
  const [stateFilter, setStateFilter] = useState<WordState | "all" | "learning">("all");
  const [bookFilter, setBookFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Sort state
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Action loading states
  const [isExporting, setIsExporting] = useState(false);
  const [isMarkingKnown, setIsMarkingKnown] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

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
    if (stateFilter !== "all") {
      if (stateFilter === "learning") {
        // "Learning" includes new, level1-4 (not known or ignored)
        result = result.filter(
          (e) => e.state !== "known" && e.state !== "ignored"
        );
      } else {
        result = result.filter((e) => e.state === stateFilter);
      }
    }

    // Apply book filter
    if (bookFilter !== "all") {
      result = result.filter((e) => e.bookId === bookFilter);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(
        (e) =>
          e.text.toLowerCase().includes(query) ||
          e.translation.toLowerCase().includes(query) ||
          e.sentence.toLowerCase().includes(query)
      );
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "text":
          comparison = a.text.localeCompare(b.text);
          break;
        case "createdAt":
          comparison =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "state":
          comparison = stateOrder[a.state] - stateOrder[b.state];
          break;
        case "bookId":
          const titleA = a.bookId ? bookTitleMap.get(a.bookId) || "" : "";
          const titleB = b.bookId ? bookTitleMap.get(b.bookId) || "" : "";
          comparison = titleA.localeCompare(titleB);
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [
    entries,
    stateFilter,
    bookFilter,
    searchQuery,
    sortField,
    sortDirection,
    bookTitleMap,
  ]);

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
    [filteredEntries]
  );

  // Handle sort column click
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Sort indicator component
  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return (
      <span className="ml-1">
        {sortDirection === "asc" ? (
          <svg className="inline h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        ) : (
          <svg className="inline h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </span>
    );
  };

  // Bulk action handlers
  const handleExportToAnki = async () => {
    if (selectedIds.size === 0) return;
    setIsExporting(true);
    try {
      await onExportToAnki(Array.from(selectedIds));
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
    filteredEntries.length > 0 &&
    filteredEntries.every((e) => selectedIds.has(e.id));
  const someSelected = selectedIds.size > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Filters and Search */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search words, translations, or sentences..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400"
          />
        </div>

        {/* State Filter */}
        <select
          value={stateFilter}
          onChange={(e) =>
            setStateFilter(e.target.value as WordState | "all" | "learning")
          }
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
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
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
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
        <button
          onClick={handleExportToAnki}
          disabled={!someSelected || isExporting}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400 dark:disabled:bg-gray-600"
        >
          {isExporting ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Exporting...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Export to Anki ({selectedIds.size})
            </>
          )}
        </button>

        <button
          onClick={handleMarkAsKnown}
          disabled={!someSelected || isMarkingKnown}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400 dark:disabled:bg-gray-600"
        >
          {isMarkingKnown ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Updating...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Mark as Known ({selectedIds.size})
            </>
          )}
        </button>

        <div className="flex-1" />

        <button
          onClick={handleSyncWithAnki}
          disabled={isSyncing}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {isSyncing ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Syncing...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Sync with Anki
            </>
          )}
        </button>
      </div>

      {/* Results count */}
      <div className="text-sm text-gray-600 dark:text-gray-400">
        Showing {filteredEntries.length} of {entries.length} entries
        {someSelected && ` (${selectedIds.size} selected)`}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-left">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="w-12 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                onClick={() => handleSort("text")}
              >
                Word/Phrase
                <SortIndicator field="text" />
              </th>
              <th className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Translation
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-center text-sm font-semibold text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                onClick={() => handleSort("state")}
              >
                State
                <SortIndicator field="state" />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                onClick={() => handleSort("bookId")}
              >
                Source
                <SortIndicator field="bookId" />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                onClick={() => handleSort("createdAt")}
              >
                Date Added
                <SortIndicator field="createdAt" />
              </th>
              <th className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Anki
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <svg
                      className="h-8 w-8 animate-spin text-blue-600"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <span className="text-gray-600 dark:text-gray-400">
                      Loading vocabulary...
                    </span>
                  </div>
                </td>
              </tr>
            ) : filteredEntries.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-gray-500 dark:text-gray-400"
                >
                  {entries.length === 0
                    ? "No vocabulary entries yet. Start reading to add words!"
                    : "No entries match your filters."}
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
    </div>
  );
}
