import type { ExtractedArticle } from '@/app/api/extract-url/route';

export default function PreviewStep({
  title,
  author,
  onTitleChange,
  onAuthorChange,
  isSaving,
  article,
}: {
  title: string;
  author: string;
  onTitleChange: (title: string) => void;
  onAuthorChange: (author: string) => void;
  isSaving: boolean;
  article: ExtractedArticle | null;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="title-input"
            className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Title
          </label>
          <input
            id="title-input"
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            disabled={isSaving}
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-900 focus:ring-2 focus:ring-zinc-900 focus:outline-none disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:ring-zinc-100"
          />
        </div>
        <div>
          <label
            htmlFor="author-input"
            className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Author / Source
          </label>
          <input
            id="author-input"
            type="text"
            value={author}
            onChange={(e) => onAuthorChange(e.target.value)}
            disabled={isSaving}
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-900 focus:ring-2 focus:ring-zinc-900 focus:outline-none disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:ring-zinc-100"
          />
        </div>
      </div>

      {article && (
        <div className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
          <span>{article.wordCount.toLocaleString()} words</span>
          {article.siteName && <span>from {article.siteName}</span>}
        </div>
      )}

      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Content Preview
        </label>
        <div className="h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm whitespace-pre-wrap text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
          {article?.content}
        </div>
      </div>
    </div>
  );
}
