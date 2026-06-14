import { BookOpen, CloudUpload } from 'lucide-react';

export default function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
        <BookOpen className="h-8 w-8 text-zinc-400 dark:text-zinc-500" strokeWidth={1.5} />
      </div>
      <h3 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        No books in your library
      </h3>
      <p className="mb-6 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        Import a book (EPUB or Markdown) to start learning. Your vocabulary and progress will be
        tracked as you read.
      </p>
      <button
        onClick={onImport}
        className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <CloudUpload className="h-5 w-5" />
        Import Book
      </button>
    </div>
  );
}
