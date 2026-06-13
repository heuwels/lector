import type { Collection, VocabEntry } from "@/types";

export type SortField = "text" | "createdAt" | "state" | "bookId";
export type SortDirection = "asc" | "desc";
export type AnkiCardType = 'basic' | 'cloze';

export  interface VocabListProps {
    entries: VocabEntry[];
    collections: Collection[];
    onEntryClick: (entry: VocabEntry) => void;
    onExportToAnki: (ids: string[], cardType: AnkiCardType) => Promise<void>;
    onMarkAsKnown: (ids: string[]) => Promise<void>;
    onSyncWithAnki: () => Promise<void>;
    isLoading?: boolean;
}