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
    /** Pull-sync via browser→AnkiConnect — selfhost only (#241). Omit to hide
     *  the button (cloud: the addon pushes review state on its own). */
    onSyncWithAnki?: () => Promise<void>;
    isLoading?: boolean;
}