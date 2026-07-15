'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, UserRound, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  importYouTubeTranscript,
  resolveYouTubeTranscript,
  type YouTubeCaptionTrack,
} from '@/lib/data-layer';
import type { YouTubeImportModalProps, YouTubeModalState } from './types';

export default function YouTubeImportModal({
  isOpen,
  onClose,
  onImported,
}: YouTubeImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [state, setState] = useState<YouTubeModalState>({ phase: 'input' });

  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on open */
  useEffect(() => {
    if (isOpen) {
      setUrl('');
      setState({ phase: 'input' });
    }
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleResolve = useCallback(async () => {
    if (!url.trim()) return;
    setState({ phase: 'resolving' });
    const result = await resolveYouTubeTranscript(url.trim());
    if (!result.ok) {
      setState({ phase: 'error', message: result.message });
      return;
    }
    setState({ phase: 'select', data: result.data });
  }, [url]);

  const handleImport = useCallback(
    async (track: YouTubeCaptionTrack) => {
      setState((prev) =>
        prev.phase === 'select' ? { phase: 'importing', data: prev.data, track } : prev,
      );
      try {
        const imported = await importYouTubeTranscript({
          url: url.trim(),
          languageCode: track.languageCode,
          kind: track.kind,
        });
        onImported({
          collectionId: imported.collectionId,
          lessonId: imported.lessonId,
          title: imported.title,
        });
        onClose();
      } catch (err) {
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : 'Could not import the transcript.',
        });
      }
    },
    [url, onImported, onClose],
  );

  const handleKeyPress = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && state.phase === 'input') handleResolve();
    },
    [state.phase, handleResolve],
  );

  const busy = state.phase === 'resolving' || state.phase === 'importing';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        initialFocus={inputRef}
        className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <DialogTitle>Import YouTube Transcript</DialogTitle>
          <DialogClose
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            aria-label="Close"
          >
            <X size="20" />
          </DialogClose>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {(state.phase === 'input' || state.phase === 'resolving' || state.phase === 'error') && (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="yt-url-input"
                  className="mb-2 block text-sm font-medium text-foreground"
                >
                  YouTube video URL
                </label>
                <div className="flex gap-3">
                  <input
                    ref={inputRef}
                    id="yt-url-input"
                    data-testid="yt-url-input"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="https://www.youtube.com/watch?v=..."
                    disabled={state.phase === 'resolving'}
                    className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50"
                  />
                  <Button
                    onClick={handleResolve}
                    disabled={!url.trim() || state.phase === 'resolving'}
                    data-testid="yt-find-captions"
                    className="px-5 py-2.5"
                  >
                    {state.phase === 'resolving' ? (
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                        Finding…
                      </div>
                    ) : (
                      'Find captions'
                    )}
                  </Button>
                </div>
              </div>

              {state.phase === 'error' && (
                <div
                  data-testid="yt-import-error"
                  className="rounded-lg border border-destructive/30 bg-destructive/10 p-4"
                >
                  <p className="text-sm text-destructive">{state.message}</p>
                  <button
                    onClick={() => setState({ phase: 'input' })}
                    className="mt-2 text-sm font-medium text-destructive hover:underline"
                  >
                    Try again
                  </button>
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                Imports a video&apos;s available transcript as a lesson with clickable timestamps.
                The video is never downloaded or hosted — clicking a line opens YouTube at that
                moment.
              </p>
            </div>
          )}

          {(state.phase === 'select' || state.phase === 'importing') && (
            <div className="space-y-4">
              <div>
                <h3 className="font-medium text-foreground">{state.data.title}</h3>
                {state.data.channel && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <UserRound className="h-3.5 w-3.5" />
                    {state.data.channel}
                  </p>
                )}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">Choose a caption track</p>
                <ul className="space-y-2" data-testid="yt-track-list">
                  {state.data.tracks.map((track) => (
                    <li key={`${track.languageCode}-${track.kind}`}>
                      <button
                        data-testid="yt-track-option"
                        disabled={busy}
                        onClick={() => handleImport(track)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{track.languageName}</span>
                          <span className="text-xs text-muted-foreground">
                            ({track.languageCode})
                          </span>
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            track.kind === 'asr'
                              ? 'bg-muted text-muted-foreground'
                              : 'bg-primary/10 text-primary'
                          }`}
                        >
                          {track.kind === 'asr' ? 'Auto-generated' : 'Creator captions'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              {state.phase === 'importing' && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  Importing “{state.track.languageName}” transcript…
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Auto-generated captions can contain recognition errors. You can edit the transcript
                text after importing.
              </p>
            </div>
          )}
        </div>

        {state.phase === 'select' && (
          <div className="flex items-center justify-end gap-3 border-t border-border bg-muted px-6 py-4">
            <Button variant="ghost" onClick={() => setState({ phase: 'input' })}>
              Back
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
