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
} from '@dnd-kit/sortable';
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
