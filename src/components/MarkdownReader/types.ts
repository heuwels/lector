import type { Lesson, LessonSummary, WordState } from "@/types";

export interface MarkdownReaderProps {
    lesson: Lesson;
    onWordClick: (word: string, sentence: string) => void;
    /** Whether the word/phrase drawer this reader feeds is open. When it closes
     *  (Esc, the X, clicking away) the reader clears its word/phrase highlight. */
    wordPanelOpen?: boolean;
    onClose: () => void;
    onSaveText?: (textContent: string) => Promise<void>;
    onEditingChange?: (isEditing: boolean) => void;
    knownWordsMap: Map<string, WordState>;
    prevLesson?: LessonSummary | null;
    nextLesson?: LessonSummary | null;
}
