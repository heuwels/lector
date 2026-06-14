"use client";

import { Check, ChevronDown, ChevronUp, Loader2, RefreshCw, Upload } from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import type { WordState } from "@/lib/data-layer";
import VocabRow from "./components/VocabRow";
import { stateFilters, stateOrder } from "./constants";
import { AnkiCardType, SortDirection, SortField, VocabListProps } from "./types";

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
                    onClick={openExportModal}
                    disabled={!someSelected || isExporting}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400 dark:disabled:bg-gray-600"
                >
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
                </button>

                <button
                    onClick={handleMarkAsKnown}
                    disabled={!someSelected || isMarkingKnown}
                    className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400 dark:disabled:bg-gray-600"
                >
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
                </button>

                <div className="flex-1" />

                <button
                    onClick={handleSyncWithAnki}
                    disabled={isSyncing}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
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
                                        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
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
                        className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                            Export to Anki
                        </h2>
                        <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">
                            {selectedIds.size} {selectedIds.size === 1 ? 'word' : 'words'} selected. Choose a card type.
                        </p>

                        <div className="mb-6 grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                data-testid="anki-card-type-basic"
                                aria-pressed={cardType === 'basic'}
                                onClick={() => updateCardType('basic')}
                                className={`rounded-lg border p-4 text-left transition-colors ${cardType === 'basic'
                                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500 dark:bg-blue-900/20'
                                    : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-medium text-zinc-900 dark:text-zinc-100">Basic</span>
                                    {cardType === 'basic' && (
                                        <Check className="h-4 w-4 text-blue-600 dark:text-blue-400" strokeWidth={3} />
                                    )}
                                </div>
                                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                    Front/back card. Sentence on front, translation on back.
                                </p>
                            </button>

                            <button
                                type="button"
                                data-testid="anki-card-type-cloze"
                                aria-pressed={cardType === 'cloze'}
                                onClick={() => updateCardType('cloze')}
                                className={`rounded-lg border p-4 text-left transition-colors ${cardType === 'cloze'
                                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500 dark:bg-blue-900/20'
                                    : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-medium text-zinc-900 dark:text-zinc-100">Cloze</span>
                                    {cardType === 'cloze' && (
                                        <Check className="h-4 w-4 text-blue-600 dark:text-blue-400" strokeWidth={3} />
                                    )}
                                </div>
                                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                    Word is hidden in the sentence; recall it from context.
                                </p>
                            </button>
                        </div>

                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setExportModalOpen(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                data-testid="anki-export-confirm"
                                onClick={confirmExportToAnki}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                Export {selectedIds.size} {selectedIds.size === 1 ? 'card' : 'cards'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
