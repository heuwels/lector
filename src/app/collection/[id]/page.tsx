'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import LessonFormModal from '@/components/LessonFormModal';
import { ReadingSweep } from '@/components/Loaders';
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
  retryTranscription,
  type Collection,
  type CollectionGroup,
  type LessonSummary,
} from '@/lib/data-layer';
import SortableLessonRow from '../components/SortableLessonRow';
import { toast } from 'sonner';

export default function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [groups, setGroups] = useState<CollectionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [editingInitial, setEditingInitial] = useState<{
    title: string;
    textContent: string;
  } | null>(null);

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
    try {
      await deleteCollection(id);
      router.push('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete collection');
    }
  }

  async function handleDeleteLesson(lessonId: string, title: string) {
    if (!confirm(`Delete "${title}"?`)) return;
    try {
      await deleteLesson(lessonId);
      setLessons((prev) => prev.filter((l) => l.id !== lessonId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete lesson');
    }
  }

  async function refreshLessons() {
    const updated = await getLessonsForCollection(id);
    setLessons(updated);
  }

  // While an audio lesson is transcribing in the background (#185), poll the
  // list so the row flips to readable (or to a retryable error) on its own.
  const hasTranscribing = lessons.some(
    (l) => l.transcriptionStatus === 'pending' || l.transcriptionStatus === 'processing',
  );
  useEffect(() => {
    if (!hasTranscribing) return;
    const timer = setInterval(async () => {
      try {
        setLessons(await getLessonsForCollection(id));
      } catch {
        /* transient — next tick retries */
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [hasTranscribing, id]);

  async function handleRetryTranscription(lessonId: string) {
    try {
      await retryTranscription(lessonId);
      await refreshLessons();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not retry transcription');
    }
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
    try {
      await updateLesson(editingLessonId, data);
      await refreshLessons();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update lesson');
      throw error;
    }
  }

  function handleLessonDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const previous = lessons;
    const oldIndex = previous.findIndex((l) => l.id === active.id);
    const newIndex = previous.findIndex((l) => l.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(previous, oldIndex, newIndex);
    setLessons(next);
    void reorderLessons(
      id,
      next.map((l) => l.id),
    ).catch((error) => {
      setLessons(previous);
      toast.error(error instanceof Error ? error.message : 'Could not reorder lessons');
    });
  }

  async function handleGroupChange(value: string) {
    try {
      if (value === '__new__') {
        const name = prompt('New group name:');
        if (!name?.trim()) return;
        const newId = await createGroup(name.trim());
        await updateCollection(id, { groupId: newId });
        const [updatedCol, updatedGroups] = await Promise.all([getCollection(id), getAllGroups()]);
        if (updatedCol) setCollection(updatedCol);
        setGroups(updatedGroups);
      } else {
        const groupId = value === '' ? null : value;
        await updateCollection(id, { groupId });
        const updatedCol = await getCollection(id);
        if (updatedCol) setCollection(updatedCol);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update collection');
    }
  }

  function getContinueLesson(): LessonSummary | undefined {
    // Find first incomplete lesson
    return lessons.find((l) => l.progress_percentComplete < 95);
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="flex h-64 items-center justify-center">
          <ReadingSweep label="Loading collection" />
        </div>
      </main>
    );
  }

  if (!collection) return null;

  const continueLesson = getContinueLesson();
  const completedCount = lessons.filter((l) => l.progress_percentComplete >= 95).length;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Back link */}
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Library
      </Link>

      {/* Collection header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">{collection.title}</h1>
        <p className="mt-1 text-muted-foreground">
          {collection.author} &middot; {lessons.length}{' '}
          {lessons.length === 1 ? 'lesson' : 'lessons'}
          {completedCount > 0 && ` \u00b7 ${completedCount} completed`}
        </p>

        {/* Group selector */}
        <div className="mt-3 flex items-center gap-2">
          <label htmlFor="group-select" className="text-sm text-muted-foreground">
            Group:
          </label>
          <select
            id="group-select"
            value={collection.groupId || ''}
            onChange={(e) => handleGroupChange(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
            data-testid="group-select"
          >
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value="__new__">+ New group...</option>
          </select>
        </div>

        <div className="mt-4 flex items-center gap-3">
          {continueLesson && (
            <Link
              href={`/read/${continueLesson.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Continue Reading
            </Link>
          )}
          <button
            onClick={handleDelete}
            className="rounded-lg px-4 py-2.5 text-sm text-destructive hover:bg-accent"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Lesson list */}
      <div className="space-y-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleLessonDragEnd}
        >
          <SortableContext items={lessons.map((l) => l.id)} strategy={verticalListSortingStrategy}>
            {lessons.map((lesson, i) => (
              <SortableLessonRow
                key={lesson.id}
                lesson={lesson}
                index={i}
                onEdit={openEditLesson}
                onDelete={handleDeleteLesson}
                onRetryTranscription={handleRetryTranscription}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* Add lesson button */}
        <button
          onClick={() => setIsAddOpen(true)}
          data-testid="add-lesson"
          className="group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-transparent px-5 py-4 text-sm font-medium text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
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
  );
}
