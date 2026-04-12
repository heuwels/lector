'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import NavHeader from '@/components/NavHeader';
import {
  getCollection,
  getLessonsForCollection,
  deleteCollection,
  type Collection,
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
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [col, les] = await Promise.all([
          getCollection(id),
          getLessonsForCollection(id),
        ]);
        if (!col) {
          router.push('/');
          return;
        }
        setCollection(col);
        setLessons(les);
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
            {completedCount > 0 && ` &middot; ${completedCount} completed`}
          </p>

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
              <Link
                key={lesson.id}
                href={`/read/${lesson.id}`}
                className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-5 py-4 transition-all hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
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
            );
          })}
        </div>
      </main>
    </div>
  );
}
