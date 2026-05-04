'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import NavHeader from '@/components/NavHeader';
import {
  getCollection,
  getLessonsForCollection,
  deleteCollection,
  deleteLesson,
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
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 sm:ml-56">
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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 sm:ml-56">
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
          {lessons.map((lesson, i) => {
            const progress = Math.round(lesson.progress_percentComplete);
            const isComplete = progress >= 95;

            return (
              <div
                key={lesson.id}
                className="group flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-5 py-4 transition-all hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
              >
                <Link
                  href={`/read/${lesson.id}`}
                  className="flex flex-1 items-center gap-4 min-w-0"
                >
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
                      i + 1
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

                {/* Delete button */}
                <button
                  onClick={() => handleDeleteLesson(lesson.id, lesson.title)}
                  className="flex-shrink-0 rounded-lg p-2 text-zinc-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  title="Delete lesson"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
