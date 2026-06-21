'use client';

import {
    useEffect,
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
import {
    getKnownWordsMap,
    updateLessonProgress,
    getSetting,
} from '@/lib/data-layer';
import type { WordState } from '@/types';
import { snapToWordBoundaries, splitWords, collectWords, computePhraseHighlightSet } from './utils';
import { stateClasses } from './theme';
import { MarkdownReaderProps } from './types';
import { Button } from '@/components/ui/button';

export default function MarkdownReader({
    lesson,
    onWordClick,
    onClose,
    onSaveText,
    onEditingChange,
    refreshTrigger = 0,
    prevLesson,
    nextLesson,
}: MarkdownReaderProps) {
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement>(null);
    const [knownWordsMap, setKnownWordsMap] = useState<Map<string, WordState>>(new Map());
    const [highlightedPhrase, setHighlightedPhrase] = useState<string[]>([]);
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

    // Load saved scroll position
    useEffect(() => {
        getSetting<{ percentage: number }>(`reading-position-${lesson.id}`).then((pos) => {
            if (pos && containerRef.current) {
                const scrollTop = (pos.percentage / 100) * containerRef.current.scrollHeight;
                containerRef.current.scrollTop = scrollTop;
            }
        });
    }, [lesson.id]);

    // Save scroll position on scroll
    const handleScroll = useCallback(() => {
        if (!containerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
        const percentage = Math.round((scrollTop / (scrollHeight - clientHeight)) * 100) || 0;
        setScrollPercentage(percentage);
        updateLessonProgress(lesson.id, { scrollPosition: scrollTop, percentComplete: percentage });
    }, [lesson.id]);

    const getWordState = (word: string): WordState | undefined => {
        return knownWordsMap.get(word.toLowerCase());
    };

    const findSentence = (element: HTMLElement): string => {
        const block = element.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6');
        const text = block?.textContent || '';
        const wordText = element.textContent || '';

        const sentences = text.split(/(?<=[.!?])\s+/);
        for (const sentence of sentences) {
            if (sentence.includes(wordText)) {
                return sentence.trim();
            }
        }
        return text.trim();
    };

    // Recursively wrap word leaves in clickable, state-colored spans while
    // preserving inline formatting (<strong>/<em>/<a>/…). `ctx.i` is a running
    // word index across the whole block so phrase highlighting stays continuous
    // even across bold/italic boundaries.
    const renderChildren = (
        children: ReactNode,
        ctx: { i: number; phraseSet: Set<number> },
        keyPrefix = 'r',
    ): ReactNode => {
        if (typeof children === 'string') {
            return splitWords(children).map((part, k) => {
                if (!part.isWord) return <span key={`${keyPrefix}-${k}`} data-leaf="">{part.text}</span>;
                const currentWordIndex = ctx.i++;
                const state = getWordState(part.text);
                const colorClass = state ? stateClasses[state] : stateClasses.new;
                const isPhraseHighlighted = ctx.phraseSet.has(currentWordIndex);
                return (
                    <span
                        key={`${keyPrefix}-${k}`}
                        data-leaf=""
                        onClick={(e) => {
                            clearPhraseHighlight();
                            const sentence = findSentence(e.currentTarget);
                            onWordClick(part.text, sentence);
                        }}
                        data-phrase-highlighted={isPhraseHighlighted || undefined}
                        className={`cursor-pointer rounded-[7px] px-[7px] font-bold hover:ring-2 hover:ring-ring/50 ${colorClass}`}
                        style={isPhraseHighlighted ? { backgroundColor: 'color-mix(in srgb, var(--clay) 22%, transparent)' } : undefined}
                    >
                        {part.text}
                    </span>
                );
            });
        }
        if (Array.isArray(children)) {
            return children.map((child, k) => (
                <Fragment key={`${keyPrefix}-${k}`}>{renderChildren(child, ctx, `${keyPrefix}-${k}`)}</Fragment>
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
    const renderBlock = (children: ReactNode): ReactNode => {
        const phraseSet = computePhraseHighlightSet(collectWords(children), highlightedPhrase);
        return renderChildren(children, { i: 0, phraseSet });
    };

    const content = lesson.textContent;

    // Set highlighted phrase words (React state, survives re-renders)
    const highlightPhrase = useCallback((text: string) => {
        if (!text) {
            setHighlightedPhrase([]);
            return;
        }
        setHighlightedPhrase(text.toLowerCase().split(/\s+/));
    }, []);

    const clearPhraseHighlight = useCallback(() => {
        setHighlightedPhrase([]);
    }, []);

    // Handle text selection for phrases
    const handleMouseUp = useCallback(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const rawText = selection.toString().trim();
        if (!rawText || !rawText.includes(' ')) return;

        // Snap to word boundaries
        const snappedText = snapToWordBoundaries(selection);
        if (!snappedText || !snappedText.includes(' ')) return;

        const sentence = findSentence(selection.anchorNode?.parentElement as HTMLElement);

        // Clear browser selection but apply our own visual highlight
        selection.removeAllRanges();
        highlightPhrase(snappedText);

        onWordClick(snappedText, sentence);
    }, [onWordClick, highlightPhrase]);

    return (
        <div className="flex flex-col h-full bg-card">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-2 border-b border-border">
                <button
                    onClick={onClose}
                    disabled={isEditing}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg
            text-muted-foreground
            hover:bg-accent
            transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                    <ArrowLeft className="w-5 h-5" />
                    <span className="hidden sm:inline">Back</span>
                </button>

                <h1 className="text-sm sm:text-lg font-medium text-foreground truncate flex-1 text-center mx-2">
                    {lesson.title}
                </h1>

                {isEditing ? (
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEdit}
                            disabled={isSaving}
                            data-testid="edit-text-cancel"
                        >
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={saveEdit}
                            disabled={isSaving}
                            data-testid="edit-text-save"
                        >
                            {isSaving ? 'Saving…' : 'Save changes'}
                        </Button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <div className="text-sm text-muted-foreground">
                            {scrollPercentage}%
                        </div>
                        {onSaveText && (
                            <button
                                onClick={startEdit}
                                data-testid="edit-text-button"
                                title="Edit text"
                                aria-label="Edit text"
                                className="p-2 rounded-lg
                  text-muted-foreground
                  hover:bg-accent
                  transition-colors"
                            >
                                <SquarePen className="w-5 h-5" />
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
                className="flex-1 overflow-auto"
            >
                {isEditing ? (
                    <div className="max-w-[38em] mx-auto px-4 sm:px-8 py-8 sm:py-12">
                        <textarea
                            data-testid="edit-text-textarea"
                            value={draftContent}
                            onChange={(e) => setDraftContent(e.target.value)}
                            disabled={isSaving}
                            autoFocus
                            spellCheck={false}
                            className="w-full min-h-[60vh] p-4 rounded-lg
                border border-input
                bg-background
                text-foreground
                text-base leading-relaxed
                font-mono
                focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring
                disabled:opacity-60 disabled:cursor-not-allowed
                resize-y"
                        />
                        {saveError && (
                            <p
                                data-testid="edit-text-error"
                                className="mt-2 text-sm text-destructive"
                            >
                                {saveError}
                            </p>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">
                            Markdown is supported. Vocab state is keyed by word, so edits don&apos;t reset your progress.
                        </p>
                    </div>
                ) : (
                    <article
                        className="max-w-[38em] mx-auto px-4 sm:px-8 py-8 sm:py-16 text-foreground"
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
                                h1: ({ children }) => <h1 className="mt-8 mb-4 font-sans text-3xl font-extrabold first:mt-0">{children}</h1>,
                                h2: ({ children }) => <h2 className="mt-8 mb-3 font-sans text-2xl font-bold first:mt-0">{children}</h2>,
                                h3: ({ children }) => <h3 className="mt-6 mb-2 font-sans text-xl font-bold first:mt-0">{children}</h3>,
                                p: ({ children }) => <p className="my-5 text-lg leading-[1.9] sm:text-xl">{renderBlock(children)}</p>,
                                ul: ({ children }) => <ul className="my-5 list-disc space-y-2 pl-6 text-lg sm:text-xl">{children}</ul>,
                                ol: ({ children }) => <ol className="my-5 list-decimal space-y-2 pl-6 text-lg sm:text-xl">{children}</ol>,
                                li: ({ children }) => <li className="leading-relaxed">{renderBlock(children)}</li>,
                                blockquote: ({ children }) => <blockquote className="my-6 border-l-4 border-border pl-4 italic text-foreground/75">{children}</blockquote>,
                                strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                                em: ({ children }) => <em className="italic">{children}</em>,
                                a: ({ href, children }) => <a href={href ?? undefined} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{children}</a>,
                                hr: () => <hr className="my-8 border-border" />,
                            }}
                        >
                            {content}
                        </ReactMarkdown>
                    </article>
                )}

                {/* Prev/Next navigation at bottom */}
                {!isEditing && (prevLesson || nextLesson) && (
                    <div className="max-w-[38em] mx-auto px-4 sm:px-8 pb-16 flex items-center justify-between gap-4">
                        {prevLesson ? (
                            <button
                                onClick={() => router.push(`/read/${prevLesson.id}`)}
                                className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm
                  text-muted-foreground
                  hover:bg-accent transition-colors"
                            >
                                <ChevronLeft className="w-4 h-4" />
                                <span className="truncate max-w-[12em]">{prevLesson.title}</span>
                            </button>
                        ) : <div />}
                        {nextLesson ? (
                            <button
                                onClick={() => router.push(`/read/${nextLesson.id}`)}
                                className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm
                  text-muted-foreground
                  hover:bg-accent transition-colors"
                            >
                                <span className="truncate max-w-[12em]">{nextLesson.title}</span>
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        ) : <div />}
                    </div>
                )}
            </div>
        </div>
    );
}
