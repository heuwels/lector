import { VocabEntry } from "@/types";

export interface VocabRowProps {
    entry: VocabEntry;
    bookTitle?: string;
    isSelected: boolean;
    onSelect: (id: string, selected: boolean) => void;
    onClick: (entry: VocabEntry) => void;
}