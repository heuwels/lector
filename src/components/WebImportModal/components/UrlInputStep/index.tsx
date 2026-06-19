import type { KeyboardEvent, Ref } from 'react';
import { Button } from '@/components/ui/button';
import { useActiveLanguage } from '@/utils/hooks';

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
  const activeLang = useActiveLanguage();
  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="url-input"
          className="mb-2 block text-sm font-medium text-foreground"
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
            className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50"
          />
          <Button
            onClick={onExtract}
            disabled={!url.trim() || isLoading}
            className="px-5 py-2.5"
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                Extracting...
              </div>
            ) : (
              'Extract'
            )}
          </Button>
        </div>
      </div>

      {errorMessage !== null && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{errorMessage}</p>
          <button
            onClick={onRetry}
            className="mt-2 text-sm font-medium text-destructive hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Paste a URL to a news article or blog post in {activeLang.native}. The article content will be
        extracted and added to your library.
      </p>
    </div>
  );
}
