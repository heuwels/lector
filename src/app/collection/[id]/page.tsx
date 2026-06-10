'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import NavHeader from '@/components/NavHeader';
import LessonFormModal from '@/components/LessonFormModal';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getCollection,
  getLessonsForCollection,
  getLesson,
  addLessonToCollection,
  updateLesson,
  deleteCollection,
  deleteLesson,
  reorderLessons,
  updateCollection,
  getAllGroups,
  createGroup,
  type Collection,
  type CollectionGroup,
  type LessonSummary,
} from '@/lib/data-layer';

export default function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [groups, setGroups] = useState<CollectionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [editingInitial, setEditingInitial] = useState<{ title: string; textContent: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    async function load() {
      try {
        const [col, les, grps] = await Promise.all([
          getCollection(id),
          getLessonsForCollection(id),
          getAllGroups(),
        ]);
        if (!col) {
          router.push('/');
          return;
        }
        setCollection(col);
        setLessons(les);
        setGroups(grps);
      } catch (err) {
        console.error('Error loading collection:', err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [id, router]);

  async function handleDelete() {
    if (!confirm('Delete this collection and all its lessons?')) return;
    await deleteCollection(id);
    router.push('/');
  }

  async function handleDeleteLesson(lessonId: string, title: string) {
    if (!confirm(`Delete "${title}"?`)) return;
    await deleteLesson(lessonId);
    setLessons((prev) => prev.filter((l) => l.id !== lessonId));
  }

  async function refreshLessons() {
    const updated = await getLessonsForCollection(id);
    setLessons(updated);
  }

  async function handleAddLesson(data: { title: string; textContent: string }) {
    await addLessonToCollection(id, data);
    await refreshLessons();
  }

  async function openEditLesson(lessonId: string) {
    const lesson = await getLesson(lessonId);
    if (!lesson) return;
    setEditingInitial({ title: lesson.title, textContent: lesson.textContent ?? '' });
    setEditingLessonId(lessonId);
  }

  async function handleEditLesson(data: { title: string; textContent: string }) {
    if (!editingLessonId) return;
    await updateLesson(editingLessonId, data);
    await refreshLessons();
  }

  function handleLessonDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLessons((prev) => {
      const oldIndex = prev.findIndex((l) => l.id === active.id);
      const newIndex = prev.findIndex((l) => l.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      reorderLessons(id, next.map((l) => l.id));
      return next;
    });
  }

  async function handleGroupChange(value: string) {
    if (value === '__new__') {
      const name = prompt('New group name:');
      if (!name?.trim()) return;
      const newId = await createGroup(name.trim());
      await updateCollection(id, { groupId: newId });
      const [updatedCol, updatedGroups] = await Promise.all([
        getCollection(id),
        getAllGroups(),
      ]);
      if (updatedCol) setCollection(updatedCol);
      setGroups(updatedGroups);
    } else {
      const groupId = value === '' ? null : value;
      await updateCollection(id, { groupId });
      const updatedCol = await getCollection(id);
      if (updatedCol) setCollection(updatedCol);
    }
  }

  function getContinueLesson(): LessonSummary | undefined {
    // Find first incomplete lesson
    return lessons.find(l => l.progress_percentComplete < 95);
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pt-[var(--mobile-topbar-h)] sm:pt-0 sm:ml-56">
        <NavHeader />
        <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
          </div>
        </main>
      </div>
    );
  }

  if (!collection) return null;

  const continueLesson = getContinueLesson();
  const completedCount = lessons.filter(l => l.progress_percentComplete >= 95).length;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pt-[var(--mobile-topbar-h)] sm:pt-0 sm:ml-56">
      <NavHeader />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {/* Back link */}
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Library
        </Link>

        {/* Collection header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            {collection.title}
          </h1>
          <p className="mt-1 text-zinc-500 dark:text-zinc-400">
            {collection.author} &middot; {lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'}
            {completedCount > 0 && ` \u00b7 ${completedCount} completed`}
          </p>

          {/* Group selector */}
          <div className="mt-3 flex items-center gap-2">
            <label htmlFor="group-select" className="text-sm text-zinc-500 dark:text-zinc-400">
              Group:
            </label>
            <select
              id="group-select"
              value={collection.groupId || ''}
              onChange={(e) => handleGroupChange(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              data-testid="group-select"
            >
              <option value="">None</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
              <option value="__new__">+ New group...</option>
            </select>
          </div>

          <div className="mt-4 flex items-center gap-3">
            {continueLesson && (
              <Link
                href={`/read/${continueLesson.id}`}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Continue Reading
              </Link>
            )}
            <button
              onClick={handleDelete}
              className="rounded-lg px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Lesson list */}
        <div className="space-y-2">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleLessonDragEnd}>
            <SortableContext items={lessons.map((l) => l.id)} strategy={verticalListSortingStrategy}>
              {lessons.map((lesson, i) => (
                <SortableLessonRow
                  key={lesson.id}
                  lesson={lesson}
                  index={i}
                  onEdit={openEditLesson}
                  onDelete={handleDeleteLesson}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* Add lesson button */}
          <button
            onClick={() => setIsAddOpen(true)}
            data-testid="add-lesson"
            className="group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-transparent px-5 py-4 text-sm font-medium text-zinc-500 transition-all hover:border-zinc-400 hover:bg-white hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add lesson
          </button>
        </div>

        <LessonFormModal
          isOpen={isAddOpen}
          mode="create"
          onClose={() => setIsAddOpen(false)}
          onSave={handleAddLesson}
        />
        <LessonFormModal
          isOpen={editingLessonId !== null}
          mode="edit"
          initial={editingInitial}
          onClose={() => {
            setEditingLessonId(null);
            setEditingInitial(null);
          }}
          onSave={handleEditLesson}
        />
      </main>
    </div>
  );
}

function SortableLessonRow({
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
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: lesson.id });
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
      className={`group flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-4 transition-all hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 sm:px-4 ${isDragging ? 'opacity-60 shadow-md' : ''}`}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${lesson.title}`}
        data-testid={`drag-lesson-${lesson.id}`}
        className="flex-shrink-0 cursor-grab touch-none rounded-md p-1 text-zinc-300 hover:text-zinc-500 active:cursor-grabbing dark:text-zinc-600 dark:hover:text-zinc-400"
      >
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 4a1 1 0 11-2 0 1 1 0 012 0zM7 10a1 1 0 11-2 0 1 1 0 012 0zM7 16a1 1 0 11-2 0 1 1 0 012 0zM13 4a1 1 0 11-2 0 1 1 0 012 0zM13 10a1 1 0 11-2 0 1 1 0 012 0zM13 16a1 1 0 11-2 0 1 1 0 012 0z" />
        </svg>
      </button>

      <Link href={`/read/${lesson.id}`} className="flex flex-1 items-center gap-4 min-w-0">
        {/* Lesson number */}
        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium
          ${isComplete
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
          }`}>
          {isComplete ? (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            index + 1
          )}
        </div>

        {/* Lesson info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {lesson.title}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {lesson.wordCount.toLocaleString()} words
            {progress > 0 && !isComplete && ` · ${progress}%`}
          </p>
        </div>

        {/* Progress bar */}
        {progress > 0 && !isComplete && (
          <div className="w-20 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-zinc-400 dark:bg-zinc-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        <svg className="h-4 w-4 flex-shrink-0 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>

      {/* Edit button */}
      <button
        onClick={() => onEdit(lesson.id)}
        className="flex-shrink-0 rounded-lg p-2 text-zinc-400 opacity-0 transition-all hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        title="Edit lesson"
        data-testid={`edit-lesson-${lesson.id}`}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </button>

      {/* Delete button */}
      <button
        onClick={() => onDelete(lesson.id, lesson.title)}
        className="flex-shrink-0 rounded-lg p-2 text-zinc-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-900/20 dark:hover:text-red-400"
        title="Delete lesson"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}
