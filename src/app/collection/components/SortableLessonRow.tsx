import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, ChevronRight, GripVertical, SquarePen, Trash2 } from 'lucide-react';
import { LessonSummary } from '@/types';
import Link from 'next/link';

export default function SortableLessonRow({
  lesson,
  index,
  onEdit,
  onDelete,
}: {
  lesson: LessonSummary;
  index: number;
  onEdit: (id: string) => void;
  onDelete: (id: string, title: string) => void;
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-4 transition-all hover:border-zinc-300 hover:shadow-sm sm:px-4 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 ${isDragging ? 'opacity-60 shadow-md' : ''}`}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${lesson.title}`}
        data-testid={`drag-lesson-${lesson.id}`}
        className="flex-shrink-0 cursor-grab touch-none rounded-md p-1 text-zinc-300 hover:text-zinc-500 active:cursor-grabbing dark:text-zinc-600 dark:hover:text-zinc-400"
      >
        <GripVertical className="h-5 w-5" />
      </button>

      <Link href={`/read/${lesson.id}`} className="flex min-w-0 flex-1 items-center gap-4">
        {/* Lesson number */}
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium ${
            isComplete
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
          }`}
        >
          {isComplete ? <Check className="h-4 w-4" /> : index + 1}
        </div>

        {/* Lesson info */}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {lesson.title}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {lesson.wordCount.toLocaleString()} words
            {progress > 0 && !isComplete && ` · ${progress}%`}
          </p>
        </div>

        {/* Progress bar */}
        {progress > 0 && !isComplete && (
          <div className="h-1.5 w-20 rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-zinc-400 dark:bg-zinc-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-400" />
      </Link>

      {/* Edit button */}
      <button
        onClick={() => onEdit(lesson.id)}
        className="flex-shrink-0 rounded-lg p-2 text-zinc-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        title="Edit lesson"
        data-testid={`edit-lesson-${lesson.id}`}
      >
        <SquarePen className="h-4 w-4" />
      </button>

      {/* Delete button */}
      <button
        onClick={() => onDelete(lesson.id, lesson.title)}
        className="flex-shrink-0 rounded-lg p-2 text-zinc-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
        title="Delete lesson"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
