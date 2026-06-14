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
            className="mb-2 block text-sm font-medium text-foreground"
          >
            Title
          </label>
          <input
            id="title-input"
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            disabled={isSaving}
            className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50"
          />
        </div>
        <div>
          <label
            htmlFor="author-input"
            className="mb-2 block text-sm font-medium text-foreground"
          >
            Author / Source
          </label>
          <input
            id="author-input"
            type="text"
            value={author}
            onChange={(e) => onAuthorChange(e.target.value)}
            disabled={isSaving}
            className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50"
          />
        </div>
      </div>

      {article && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{article.wordCount.toLocaleString()} words</span>
          {article.siteName && <span>from {article.siteName}</span>}
        </div>
      )}

      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          Content Preview
        </label>
        <div className="h-64 overflow-y-auto rounded-lg border border-border bg-muted p-4 text-sm whitespace-pre-wrap text-muted-foreground">
          {article?.content}
        </div>
      </div>
    </div>
  );
}
