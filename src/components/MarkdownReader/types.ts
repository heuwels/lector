import type { ReactNode } from 'react';
import type { Lesson, LessonSummary, WordState } from '@/types';

/** Where a clicked word came from, when the lesson is a video transcript
 *  (#334). Threaded to the reader page so a mined card can carry the segment's
 *  timestamped source link into the Anki export. */
export interface WordSource {
  /** Base watch URL of the source video (no timestamp). */
  sourceUrl: string;
  /** Segment start/end in milliseconds. */
  startMs: number;
  endMs: number;
}

export interface MarkdownReaderProps {
  lesson: Lesson;
  onWordClick: (word: string, sentence: string, source?: WordSource) => void;
  /** Whether the word/phrase drawer this reader feeds is open. When it closes
   *  (Esc, the X, clicking away) the reader clears its word/phrase highlight. */
  wordPanelOpen?: boolean;
  onClose: () => void;
  onSaveText?: (textContent: string) => Promise<void>;
  onEditingChange?: (isEditing: boolean) => void;
  knownWordsMap: Map<string, WordState>;
  prevLesson?: LessonSummary | null;
  nextLesson?: LessonSummary | null;
  /** Extra header button(s), e.g. the listen-along toggle on audio lessons (#185). */
  headerAction?: ReactNode;
}
