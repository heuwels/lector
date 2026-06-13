import type { Lesson, LessonSummary } from "@/types";

export interface MarkdownReaderProps {
    lesson: Lesson;
    onWordClick: (word: string, sentence: string) => void;
    onClose: () => void;
    onSaveText?: (textContent: string) => Promise<void>;
    onEditingChange?: (isEditing: boolean) => void;
    refreshTrigger?: number;
    prevLesson?: LessonSummary | null;
    nextLesson?: LessonSummary | null;
}