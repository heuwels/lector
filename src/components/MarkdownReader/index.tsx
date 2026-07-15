'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, SquarePen } from 'lucide-react';
import { updateLessonProgress } from '@/lib/data-layer';
import { createTrailingThrottle } from './throttle';
import { snapToWordBoundaries } from './utils';
import { foldWord, getLanguageConfig, isValidLanguageCode, splitSentences } from '@/lib/languages';
import { useActiveLanguage } from '@/utils/hooks';
import { MarkdownReaderProps } from './types';
import { Button } from '@/components/ui/button';
import ReaderArticle, { type ActiveReaderWord } from './ReaderArticle';
import TranscriptReader from './TranscriptReader';
import YouTubePlayer, { type SeekTarget } from '@/components/YouTubePlayer';
import type { TranscriptSegment, YouTubeSourceMeta } from '@/types';

export default function MarkdownReader({
  lesson,
  onWordClick,
  wordPanelOpen = false,
  onClose,
  onSaveText,
  onEditingChange,
  knownWordsMap,
  prevLesson,
  nextLesson,
  headerAction,
}: MarkdownReaderProps) {
  const router = useRouter();
  const activeLang = useActiveLanguage();
  // Tokenize by the LESSON's language, not the active UI language: content
  // keeps its own script rules (e.g. the Afrikaans 'n article) even when it
  // renders while another language is active — reachable when the client and
  // server language settings disagree. Pre-#289 the word pattern was global,
  // which masked the difference.
  const pack =
    lesson.language && isValidLanguageCode(lesson.language)
      ? getLanguageConfig(lesson.language)
      : activeLang;
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlightedPhrase, setHighlightedPhrase] = useState<string[]>([]);
  // The single word the user last clicked (drawer target). Identified by its
  // block's source offset + word index within the block so we highlight the
  // exact instance clicked, not every occurrence of that spelling. Cleared
  // when a phrase is selected instead.
  const [activeWord, setActiveWord] = useState<ActiveReaderWord | null>(null);
  const [scrollPercentage, setScrollPercentage] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // YouTube transcript lessons (#334): parse the stored segments + provenance.
  // A malformed/empty payload falls back to the ordinary markdown reader.
  const transcript = useMemo(() => {
    if (lesson.sourceType !== 'youtube') return null;
    try {
      const segments = lesson.segments ? (JSON.parse(lesson.segments) as TranscriptSegment[]) : [];
      const meta = lesson.sourceMeta ? (JSON.parse(lesson.sourceMeta) as YouTubeSourceMeta) : null;
      if (!Array.isArray(segments) || segments.length === 0 || !meta?.videoId) return null;
      return { segments, meta };
    } catch {
      return null;
    }
  }, [lesson.sourceType, lesson.segments, lesson.sourceMeta]);

  const [seekTarget, setSeekTarget] = useState<SeekTarget | null>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const seekNonce = useRef(0);
  const handleSeek = useCallback((seconds: number, segmentIndex: number) => {
    seekNonce.current += 1;
    setSeekTarget({ seconds, nonce: seekNonce.current });
    setActiveSegmentIndex(segmentIndex);
  }, []);

  // Editing rewrites the flattened text, which would desync the timestamped
  // segments — so transcript correction is disabled for MVP (#334 follow-up).
  const canEdit = !transcript && !!onSaveText;

  const startEdit = useCallback(() => {
    setDraftContent(lesson.textContent);
    setSaveError(null);
    setIsEditing(true);
    onEditingChange?.(true);
  }, [lesson.textContent, onEditingChange]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setDraftContent('');
    setSaveError(null);
    onEditingChange?.(false);
  }, [onEditingChange]);

  const saveEdit = useCallback(async () => {
    if (!onSaveText) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSaveText(draftContent);
      setIsEditing(false);
      setDraftContent('');
      onEditingChange?.(false);
    } catch (err) {
      console.error('Failed to save lesson text:', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [draftContent, onSaveText, onEditingChange]);

  // Restore the last reading position from the lesson itself —
  // progress_scrollPosition is exactly what the scroll handler below saves.
  // (The old code read a `reading-position-*` settings key that nothing ever
  // wrote, so every partially-read lesson reopened at the top, #234.) The ref
  // guards re-runs so a prop refresh mid-read can't yank the viewport back.
  const restoredForLesson = useRef<string | null>(null);
  useEffect(() => {
    if (restoredForLesson.current === lesson.id) return;
    restoredForLesson.current = lesson.id;
    if (containerRef.current && lesson.progress_scrollPosition > 0) {
      containerRef.current.scrollTop = lesson.progress_scrollPosition;
    }
  }, [lesson.id, lesson.progress_scrollPosition]);

  // Persist scroll progress at most once per second (trailing edge, latest
  // position wins) instead of one PUT per scroll event (#234); pending state
  // is flushed on unmount/lesson change so the final position isn't lost.
  const progressWriter = useMemo(
    () =>
      createTrailingThrottle((scrollTop: number, percentage: number) => {
        updateLessonProgress(lesson.id, { scrollPosition: scrollTop, percentComplete: percentage });
      }, 1000),
    [lesson.id],
  );
  useEffect(() => () => progressWriter.flush(), [progressWriter]);

  // Save scroll position on scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const percentage = Math.round((scrollTop / (scrollHeight - clientHeight)) * 100) || 0;
    setScrollPercentage(percentage);
    progressWriter(scrollTop, percentage);
  }, [progressWriter]);

  const findSentence = useCallback(
    (element: HTMLElement): string => {
      const block = element.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6');
      const text = block?.textContent || '';
      const wordText = element.textContent || '';

      const sentences = splitSentences(text, pack);
      for (const sentence of sentences) {
        if (sentence.includes(wordText)) {
          return sentence.trim();
        }
      }
      return text.trim();
    },
    [pack],
  );

  // Set highlighted phrase words (React state, survives re-renders)
  const highlightPhrase = useCallback(
    (text: string) => {
      if (!text) {
        setHighlightedPhrase([]);
        return;
      }
      setHighlightedPhrase(text.split(/\s+/).map((w) => foldWord(w, pack)));
    },
    [pack],
  );

  const clearPhraseHighlight = useCallback(() => {
    setHighlightedPhrase([]);
  }, []);

  // Drop the word/phrase highlight when the drawer closes (Esc, the X, or a
  // click away), so a dismissed lookup doesn't leave the reader marked up.
  // Only acts on close — opening/re-targeting keeps whatever was just set.
  // Clear before paint: a passive cleanup can replace a word node after a
  // keyboard user has already focused it, sending their next keypress to body.
  useLayoutEffect(() => {
    if (!wordPanelOpen) {
      setActiveWord(null);
      setHighlightedPhrase([]);
    }
  }, [wordPanelOpen]);

  // Handle text selection for phrases
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const rawText = selection.toString().trim();
    if (!rawText || !rawText.includes(' ')) return;

    // Snap to word boundaries
    const snappedText = snapToWordBoundaries(selection, pack);
    if (!snappedText || !snappedText.includes(' ')) return;

    const sentence = findSentence(selection.anchorNode?.parentElement as HTMLElement);

    // Clear browser selection but apply our own visual highlight. The
    // single-word active highlight gives way to the phrase highlight.
    selection.removeAllRanges();
    setActiveWord(null);
    highlightPhrase(snappedText);

    onWordClick(snappedText, sentence);
  }, [onWordClick, highlightPhrase, pack, findSentence]);

  return (
    <div className="flex h-full flex-col bg-card print:block print:h-auto">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-2 print:border-0 print:px-0">
        <button
          onClick={onClose}
          disabled={isEditing}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent print:hidden"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="hidden sm:inline">Back</span>
        </button>

        <h1 className="mx-2 flex-1 truncate text-center text-sm font-medium text-foreground sm:text-lg print:mx-0 print:text-left print:text-2xl print:font-bold">
          {lesson.title}
        </h1>

        {isEditing ? (
          <div className="flex items-center gap-2 print:hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelEdit}
              disabled={isSaving}
              data-testid="edit-text-cancel"
            >
              Cancel
            </Button>
            <Button size="sm" onClick={saveEdit} disabled={isSaving} data-testid="edit-text-save">
              {isSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 print:hidden">
            <div className="text-sm text-muted-foreground">{scrollPercentage}%</div>
            {headerAction}
            {canEdit && (
              <button
                onClick={startEdit}
                data-testid="edit-text-button"
                title="Edit text"
                aria-label="Edit text"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"
              >
                <SquarePen className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
      </header>

      {/* Content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onMouseUp={handleMouseUp}
        className="flex-1 overflow-auto print:block print:h-auto print:overflow-visible"
      >
        {isEditing ? (
          <div className="mx-auto max-w-[38em] px-4 py-8 sm:px-8 sm:py-12">
            <textarea
              data-testid="edit-text-textarea"
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              disabled={isSaving}
              autoFocus
              spellCheck={false}
              className="min-h-[60vh] w-full resize-y rounded-lg border border-input bg-background p-4 font-mono text-base leading-relaxed text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
            {saveError && (
              <p data-testid="edit-text-error" className="mt-2 text-sm text-destructive">
                {saveError}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Markdown is supported. Vocab state is keyed by word, so edits don&apos;t reset your
              progress.
            </p>
          </div>
        ) : transcript ? (
          <>
            <div className="sticky top-0 z-10 mx-auto max-w-[46em] bg-card px-4 pt-4 pb-2 sm:px-8">
              <YouTubePlayer videoId={transcript.meta.videoId} seekTarget={seekTarget} />
              <a
                href={transcript.meta.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {transcript.meta.captionKind === 'asr'
                  ? 'Auto-generated captions'
                  : 'Creator captions'}
                {transcript.meta.channel ? ` · ${transcript.meta.channel}` : ''} · Open on YouTube
              </a>
            </div>
            <TranscriptReader
              segments={transcript.segments}
              sourceUrl={transcript.meta.sourceUrl}
              pack={pack}
              knownWordsMap={knownWordsMap}
              highlightedPhrase={highlightedPhrase}
              activeWord={activeWord}
              activeSegmentIndex={activeSegmentIndex}
              onWordClick={onWordClick}
              onActivateWord={setActiveWord}
              onClearPhrase={clearPhraseHighlight}
              onSeek={handleSeek}
            />
          </>
        ) : (
          <ReaderArticle
            content={lesson.textContent}
            pack={pack}
            knownWordsMap={knownWordsMap}
            highlightedPhrase={highlightedPhrase}
            activeWord={activeWord}
            onWordClick={onWordClick}
            onActivateWord={setActiveWord}
            onClearPhrase={clearPhraseHighlight}
          />
        )}

        {/* Prev/Next navigation at bottom */}
        {!isEditing && (prevLesson || nextLesson) && (
          <div className="mx-auto flex max-w-[38em] items-center justify-between gap-4 px-4 pb-16 sm:px-8 print:hidden">
            {prevLesson ? (
              <button
                onClick={() => router.push(`/read/${prevLesson.id}`)}
                className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="max-w-[12em] truncate">{prevLesson.title}</span>
              </button>
            ) : (
              <div />
            )}
            {nextLesson ? (
              <button
                onClick={() => router.push(`/read/${nextLesson.id}`)}
                className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                <span className="max-w-[12em] truncate">{nextLesson.title}</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <div />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
