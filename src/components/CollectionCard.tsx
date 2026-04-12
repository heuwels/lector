'use client';

import Link from 'next/link';
import type { Collection } from '@/lib/data-layer';

interface CollectionCardProps {
  collection: Collection;
}

export default function CollectionCard({ collection }: CollectionCardProps) {
  const progressPercent = Math.round(collection.avgProgress || 0);

  return (
    <Link
      href={`/collection/${collection.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white transition-all hover:border-zinc-300 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
    >
      {/* Cover Image */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900">
        {collection.coverUrl ? (
          <img
            src={collection.coverUrl}
            alt={`Cover of ${collection.title}`}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center">
            <svg
              className="mb-2 h-12 w-12 text-zinc-400 dark:text-zinc-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            <span className="text-sm font-medium text-zinc-500 dark:text-zinc-500">
              {collection.title.substring(0, 30)}
            </span>
          </div>
        )}

        {/* Progress overlay */}
        {progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
            <div className="flex items-center justify-between text-white">
              <span className="text-xs font-medium">{progressPercent}% complete</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full rounded-full bg-white transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Collection Info */}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {collection.title}
        </h3>
        {collection.author && (
          <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">{collection.author}</p>
        )}
        <div className="mt-auto pt-3 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {collection.lastReadAt ? formatLastRead(collection.lastReadAt) : 'Not started'}
          </span>
          {collection.lessonCount > 1 && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {collection.lessonCount} lessons
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function formatLastRead(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
