'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, SquarePen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {
    getKnownWordsMap,
    updateLessonProgress,
    getSetting,
} from '@/lib/data-layer';
import type { WordState } from '@/types';
import { snapToWordBoundaries } from './utils';
import { darkStateColors, stateColors } from './theme';
import { MarkdownReaderProps } from './types';

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
    const [isDarkMode, setIsDarkMode] = useState(false);
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

    // Detect dark mode
    useEffect(() => {
        const check = () => setIsDarkMode(document.documentElement.classList.contains('dark'));
        check();
        const observer = new MutationObserver(check);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

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

    // Wrap words in clickable spans
    const renderText = (text: string) => {
        const wordPattern = /['''ʼ`]n\b|[\wêëéèôöûüîïáà]+(?:-[\wêëéèôöûüîïáà]+)*/gi;
        const parts: { text: string; isWord: boolean }[] = [];
        let lastIndex = 0;
        let match;

        while ((match = wordPattern.exec(text)) !== null) {
            if (match.index > lastIndex) {
                parts.push({ text: text.slice(lastIndex, match.index), isWord: false });
            }
            parts.push({ text: match[0], isWord: true });
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < text.length) {
            parts.push({ text: text.slice(lastIndex), isWord: false });
        }

        // Find which word indices in this text block are part of the highlighted phrase
        const phraseHighlightSet = new Set<number>();
        if (highlightedPhrase.length > 0) {
            const wordParts = parts.filter((p) => p.isWord);
            for (let i = 0; i <= wordParts.length - highlightedPhrase.length; i++) {
                let matches = true;
                for (let j = 0; j < highlightedPhrase.length; j++) {
                    if (wordParts[i + j].text.toLowerCase() !== highlightedPhrase[j]) {
                        matches = false;
                        break;
                    }
                }
                if (matches) {
                    for (let j = 0; j < highlightedPhrase.length; j++) {
                        phraseHighlightSet.add(i + j);
                    }
                    break;
                }
            }
        }

        const colors = isDarkMode ? darkStateColors : stateColors;
        let wordIndex = 0;

        return parts.map((part, i) => {
            if (part.isWord) {
                const currentWordIndex = wordIndex++;
                const state = getWordState(part.text);
                const colorClass = state ? colors[state] : colors.new;
                const isPhraseHighlighted = phraseHighlightSet.has(currentWordIndex);

                return (
                    <span
                        key={i}
                        onClick={(e) => {
                            clearPhraseHighlight();
                            const sentence = findSentence(e.currentTarget);
                            onWordClick(part.text, sentence);
                        }}
                        data-phrase-highlighted={isPhraseHighlighted || undefined}
                        className={`cursor-pointer rounded px-0.5 hover:ring-2 hover:ring-blue-400 ${colorClass}`}
                        style={isPhraseHighlighted ? { backgroundColor: 'rgba(99, 102, 241, 0.25)' } : undefined}
                    >
                        {part.text}
                    </span>
                );
            }
            return <span key={i}>{part.text}</span>;
        });
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
        <div className="flex flex-col h-full bg-[#faf8f5] dark:bg-zinc-900">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700">
                <button
                    onClick={onClose}
                    disabled={isEditing}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg
            text-zinc-600 dark:text-zinc-400
            hover:bg-zinc-100 dark:hover:bg-zinc-800
            transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                    <ArrowLeft className="w-5 h-5" />
                    <span className="hidden sm:inline">Back</span>
                </button>

                <h1 className="text-sm sm:text-lg font-medium text-zinc-900 dark:text-zinc-100 truncate flex-1 text-center mx-2">
                    {lesson.title}
                </h1>

                {isEditing ? (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={cancelEdit}
                            disabled={isSaving}
                            data-testid="edit-text-cancel"
                            className="px-3 py-1.5 text-sm rounded-lg
                text-zinc-700 dark:text-zinc-300
                hover:bg-zinc-100 dark:hover:bg-zinc-800
                transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={saveEdit}
                            disabled={isSaving}
                            data-testid="edit-text-save"
                            className="px-3 py-1.5 text-sm font-medium rounded-lg
                bg-blue-600 text-white
                hover:bg-blue-700
                transition-colors
                disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isSaving ? 'Saving…' : 'Save changes'}
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <div className="text-sm text-zinc-500 dark:text-zinc-400">
                            {scrollPercentage}%
                        </div>
                        {onSaveText && (
                            <button
                                onClick={startEdit}
                                data-testid="edit-text-button"
                                title="Edit text"
                                aria-label="Edit text"
                                className="p-2 rounded-lg
                  text-zinc-600 dark:text-zinc-400
                  hover:bg-zinc-100 dark:hover:bg-zinc-800
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
                border border-zinc-300 dark:border-zinc-600
                bg-white dark:bg-zinc-800
                text-zinc-800 dark:text-zinc-200
                text-base leading-relaxed
                font-mono
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                disabled:opacity-60 disabled:cursor-not-allowed
                resize-y"
                        />
                        {saveError && (
                            <p
                                data-testid="edit-text-error"
                                className="mt-2 text-sm text-red-500 dark:text-red-400"
                            >
                                {saveError}
                            </p>
                        )}
                        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                            Markdown is supported. Vocab state is keyed by word, so edits don&apos;t reset your progress.
                        </p>
                    </div>
                ) : (
                    <article className="max-w-[38em] mx-auto px-4 sm:px-8 py-8 sm:py-16 prose prose-zinc dark:prose-invert
            prose-p:text-lg sm:prose-p:text-2xl prose-p:leading-[1.9] prose-p:text-zinc-700 dark:prose-p:text-zinc-300
            prose-headings:font-sans prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100
            prose-li:text-lg sm:prose-li:text-xl prose-li:leading-relaxed"
                        style={{ fontFamily: 'var(--font-literata), Georgia, serif' }}>
                        <ReactMarkdown
                            components={{
                                p: ({ children }) => <p>{typeof children === 'string' ? renderText(children) : children}</p>,
                                li: ({ children }) => <li>{typeof children === 'string' ? renderText(children) : children}</li>,
                                h1: ({ children }) => <h1>{children}</h1>,
                                h2: ({ children }) => <h2>{children}</h2>,
                                h3: ({ children }) => <h3>{children}</h3>,
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
                  text-zinc-600 dark:text-zinc-400
                  hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                            >
                                <ChevronLeft className="w-4 h-4" />
                                <span className="truncate max-w-[12em]">{prevLesson.title}</span>
                            </button>
                        ) : <div />}
                        {nextLesson ? (
                            <button
                                onClick={() => router.push(`/read/${nextLesson.id}`)}
                                className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm
                  text-zinc-600 dark:text-zinc-400
                  hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
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
