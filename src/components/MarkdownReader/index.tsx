'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  Fragment,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, SquarePen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { getKnownWordsMap, updateLessonProgress } from '@/lib/data-layer';
import { createTrailingThrottle } from './throttle';
import type { WordState } from '@/types';
import { snapToWordBoundaries, splitWords, collectWords, computePhraseHighlightSet } from './utils';
import { foldWord, getLanguageConfig, isValidLanguageCode, splitSentences } from '@/lib/languages';
import { useActiveLanguage } from '@/utils/hooks';
import { stateClasses } from './theme';
import { MarkdownReaderProps } from './types';
import { Button } from '@/components/ui/button';

export default function MarkdownReader({
  lesson,
  onWordClick,
  wordPanelOpen = false,
  onClose,
  onSaveText,
  onEditingChange,
  refreshTrigger = 0,
  prevLesson,
  nextLesson,
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
  const [knownWordsMap, setKnownWordsMap] = useState<Map<string, WordState>>(new Map());
  const [highlightedPhrase, setHighlightedPhrase] = useState<string[]>([]);
  // The single word the user last clicked (drawer target). Identified by its
  // block's source offset + word index within the block so we highlight the
  // exact instance clicked, not every occurrence of that spelling. Cleared
  // when a phrase is selected instead.
  const [activeWord, setActiveWord] = useState<{ blockId: number; wordIndex: number } | null>(null);
  const [scrollPercentage, setScrollPercentage] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // Load known words map
  useEffect(() => {
    getKnownWordsMap().then(setKnownWordsMap);
  }, [refreshTrigger]);

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

  const getWordState = (word: string): WordState | undefined => {
    return knownWordsMap.get(foldWord(word, pack));
  };

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

  // Recursively wrap word leaves in clickable, state-colored spans while
  // preserving inline formatting (<strong>/<em>/<a>/…). `ctx.i` is a running
  // word index across the whole block so phrase highlighting stays continuous
  // even across bold/italic boundaries.
  const renderChildren = (
    children: ReactNode,
    ctx: { i: number; phraseSet: Set<number>; blockId: number },
    keyPrefix = 'r',
  ): ReactNode => {
    if (typeof children === 'string') {
      return splitWords(children, pack).map((part, k) => {
        if (!part.isWord)
          return (
            <span key={`${keyPrefix}-${k}`} data-leaf="">
              {part.text}
            </span>
          );
        const currentWordIndex = ctx.i++;
        const state = getWordState(part.text);
        const colorClass = state ? stateClasses[state] : stateClasses.new;
        const isPhraseHighlighted = ctx.phraseSet.has(currentWordIndex);
        const isActiveWord =
          activeWord?.blockId === ctx.blockId && activeWord?.wordIndex === currentWordIndex;
        const isHighlighted = isPhraseHighlighted || isActiveWord;
        return (
          <span
            key={`${keyPrefix}-${k}`}
            data-leaf=""
            data-testid="reader-word"
            role="button"
            tabIndex={0}
            aria-label={`Look up ${part.text}`}
            onClick={(e) => {
              clearPhraseHighlight();
              setActiveWord({ blockId: ctx.blockId, wordIndex: currentWordIndex });
              const sentence = findSentence(e.currentTarget);
              onWordClick(part.text, sentence);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              clearPhraseHighlight();
              setActiveWord({ blockId: ctx.blockId, wordIndex: currentWordIndex });
              const sentence = findSentence(e.currentTarget);
              onWordClick(part.text, sentence);
            }}
            data-phrase-highlighted={isPhraseHighlighted || undefined}
            data-active-word={isActiveWord || undefined}
            className={`cursor-pointer rounded-[7px] px-[7px] font-bold hover:ring-2 hover:ring-ring/50 ${colorClass} ${isActiveWord ? 'ring-2 ring-[var(--clay)]' : ''}`}
            style={
              isHighlighted
                ? { backgroundColor: 'color-mix(in srgb, var(--clay) 22%, transparent)' }
                : undefined
            }
          >
            {part.text}
          </span>
        );
      });
    }
    if (Array.isArray(children)) {
      return children.map((child, k) => (
        <Fragment key={`${keyPrefix}-${k}`}>
          {renderChildren(child, ctx, `${keyPrefix}-${k}`)}
        </Fragment>
      ));
    }
    if (isValidElement(children)) {
      const el = children as ReactElement<{ children?: ReactNode }>;
      // Already a leaf span we emitted — return as-is. A loose markdown list
      // renders each item as <li><p>…</p></li>, and both the `li` and `p`
      // components run renderBlock(); without this guard the inner pass would
      // re-wrap the words the outer pass already wrapped, producing nested
      // duplicate (double-highlighted) word spans.
      if ((el.props as Record<string, unknown>)['data-leaf'] !== undefined) {
        return el;
      }
      return cloneElement(el, {}, renderChildren(el.props.children, ctx, keyPrefix));
    }
    return children;
  };

  // Render a markdown block's children with per-word highlighting. The phrase
  // set is computed over the block's full word list first so indices line up
  // with the spans renderChildren emits (incl. words inside bold/italic).
  const renderBlock = (children: ReactNode, blockId: number): ReactNode => {
    const phraseSet = computePhraseHighlightSet(
      collectWords(children, pack),
      highlightedPhrase,
      pack,
    );
    return renderChildren(children, { i: 0, phraseSet, blockId });
  };

  const content = lesson.textContent;

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
            {onSaveText && (
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
        ) : (
          <article
            className="mx-auto max-w-[38em] px-4 py-8 text-foreground sm:px-8 sm:py-16 print:px-0 print:py-0"
            style={{ fontFamily: 'var(--font-literata), Georgia, serif' }}
          >
            {/* Block elements are styled explicitly with design tokens (no
                            @tailwindcss/typography plugin is installed, so `prose-*` was
                            a no-op). renderBlock() keeps word-highlighting working through
                            inline markdown in the reading body; remark-breaks renders single
                            newlines as <br>. Headings are styled but NOT word-wrapped —
                            click-to-translate stays in the body copy (and reader specs assume
                            word spans live only in p/li). */}
            <ReactMarkdown
              remarkPlugins={[remarkBreaks]}
              components={{
                h1: ({ children }) => (
                  <h1 className="mt-8 mb-4 font-sans text-3xl font-extrabold first:mt-0">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="mt-8 mb-3 font-sans text-2xl font-bold first:mt-0">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="mt-6 mb-2 font-sans text-xl font-bold first:mt-0">{children}</h3>
                ),
                p: ({ node, children }) => (
                  <p className="my-5 text-lg leading-[1.9] sm:text-xl">
                    {renderBlock(children, node?.position?.start?.offset ?? 0)}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="my-5 list-disc space-y-2 pl-6 text-lg sm:text-xl">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="my-5 list-decimal space-y-2 pl-6 text-lg sm:text-xl">
                    {children}
                  </ol>
                ),
                li: ({ node, children }) => (
                  <li className="leading-relaxed">
                    {renderBlock(children, node?.position?.start?.offset ?? 0)}
                  </li>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="my-6 border-l-4 border-border pl-4 text-foreground/75 italic">
                    {children}
                  </blockquote>
                ),
                strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
                a: ({ href, children }) => (
                  <a
                    href={href ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline underline-offset-2"
                  >
                    {children}
                  </a>
                ),
                hr: () => <hr className="my-8 border-border" />,
              }}
            >
              {content}
            </ReactMarkdown>
          </article>
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
