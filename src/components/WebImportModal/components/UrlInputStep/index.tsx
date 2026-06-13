import type { KeyboardEvent, Ref } from 'react';

export default function UrlInputStep({
  url,
  onUrlChange,
  onKeyDown,
  onExtract,
  isLoading,
  errorMessage,
  onRetry,
  inputRef,
}: {
  url: string;
  onUrlChange: (url: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onExtract: () => void;
  isLoading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  inputRef: Ref<HTMLInputElement>;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="url-input"
          className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Article URL
        </label>
        <div className="flex gap-3">
          <input
            ref={inputRef}
            id="url-input"
            type="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="https://www.netwerk24.com/..."
            disabled={isLoading}
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-900 placeholder-zinc-400 focus:ring-2 focus:ring-zinc-900 focus:outline-none disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:ring-zinc-100"
          />
          <button
            onClick={onExtract}
            disabled={!url.trim() || isLoading}
            className="rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white dark:border-zinc-900/30 dark:border-t-zinc-900" />
                Extracting...
              </div>
            ) : (
              'Extract'
            )}
          </button>
        </div>
      </div>

      {errorMessage !== null && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
          <button
            onClick={onRetry}
            className="mt-2 text-sm font-medium text-red-600 hover:underline dark:text-red-400"
          >
            Try again
          </button>
        </div>
      )}

      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Paste a URL to an Afrikaans news article or blog post. The article content will be extracted
        and added to your library.
      </p>
    </div>
  );
}
