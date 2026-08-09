import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BookOpenText,
  Check,
  GripVertical,
  LoaderCircle,
  RotateCcw,
  SquarePen,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { LessonSummary } from '@/types';
import Link from 'next/link';
import { useMemo } from 'react';

export default function SortableLessonRow({
  lesson,
  index,
  onEdit,
  onDelete,
  onRetryTranscription,
}: {
  lesson: LessonSummary;
  index: number;
  onEdit: (id: string) => void;
  onDelete: (id: string, title: string) => void;
  onRetryTranscription?: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lesson.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  const progress = Math.round(lesson.progress_percentComplete);
  const isComplete = progress >= 95;
  const transcribing =
    lesson.transcriptionStatus === 'pending' || lesson.transcriptionStatus === 'processing';
  const transcriptionFailed = lesson.transcriptionStatus === 'error';

  const CTALabel = useMemo(() => {
    if (progress === 0) {
      return 'Read';
    }

    if (isComplete) {
      return 'Re-read';
    }

    return 'Continue';
  }, [progress, isComplete]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 rounded-xl border border-border bg-card px-1 py-4 transition-all hover:border-border hover:shadow-sm sm:px-4 md:gap-3 ${isDragging ? 'opacity-60 shadow-md' : ''}`}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${lesson.title}`}
        data-testid={`drag-lesson-${lesson.id}`}
        className="flex-shrink-0 cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-5 w-5" />
      </button>

      <Link
        href={`/read/${lesson.id}`}
        title={lesson.title}
        className="group flex min-w-0 flex-1 items-center gap-2 pr-2 md:gap-4 md:pr-0"
      >
        {/* Lesson number */}
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium ${
            isComplete ? 'bg-[var(--primary-soft)] text-primary' : 'bg-muted text-muted-foreground'
          }`}
        >
          {isComplete ? <Check className="h-4 w-4" /> : index + 1}
        </div>

        <div className="min-w-0 flex-1">
          {/* Lesson info */}
          <div className="">
            <h3 className="truncate text-sm font-medium text-foreground">{lesson.title}</h3>
            {transcribing ? (
              <p
                className="flex items-center gap-1 text-xs text-muted-foreground"
                data-testid={`transcribing-${lesson.id}`}
              >
                <LoaderCircle className="h-3 w-3 animate-spin" />
                Transcribing…
              </p>
            ) : transcriptionFailed ? (
              <p
                className="flex items-center gap-1 text-xs text-destructive"
                title={lesson.transcriptionError ?? undefined}
                data-testid={`transcription-error-${lesson.id}`}
              >
                <TriangleAlert className="h-3 w-3" />
                Transcription failed
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {lesson.wordCount.toLocaleString()} words
                {progress > 0 && !isComplete && ` · ${progress}%`}
              </p>
            )}
          </div>

          {/* Progress bar */}
          {progress > 0 && !isComplete && (
            <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-3 text-sm text-muted-foreground group-hover:text-foreground">
          <span className="hidden md:block">{CTALabel}</span>
          <BookOpenText className="h-4 w-4" />
        </div>
      </Link>

      {/* Retry transcription button (failed audio lessons only) */}
      {transcriptionFailed && onRetryTranscription && (
        <button
          onClick={() => onRetryTranscription(lesson.id)}
          className="flex-shrink-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Retry transcription"
          data-testid={`retry-transcription-${lesson.id}`}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      )}

      {/* Edit button */}
      <button
        onClick={() => onEdit(lesson.id)}
        className="flex-shrink-0 cursor-pointer rounded-lg p-2 text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
        title="Edit lesson"
        data-testid={`edit-lesson-${lesson.id}`}
      >
        <SquarePen className="h-4 w-4" />
      </button>

      {/* Delete button */}
      <button
        onClick={() => onDelete(lesson.id, lesson.title)}
        className="flex-shrink-0 cursor-pointer rounded-lg p-2 text-muted-foreground transition-all hover:bg-accent hover:text-destructive"
        title="Delete lesson"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
