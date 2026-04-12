'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import {
  type Lesson,
  type LessonSummary,
  type WordState,
  getKnownWordsMap,
  updateLessonProgress,
  getSetting,
} from '@/lib/data-layer';

// Color mapping for word states - background highlights
const stateColors: Record<WordState, string> = {
  new: 'bg-blue-100',
  level1: 'bg-yellow-200',
  level2: 'bg-yellow-100',
  level3: 'bg-yellow-50',
  level4: '',
  known: '',
  ignored: 'opacity-50',
};

const darkStateColors: Record<WordState, string> = {
  new: 'bg-blue-900/40',
  level1: 'bg-yellow-700/50',
  level2: 'bg-yellow-800/30',
  level3: 'bg-yellow-900/20',
  level4: '',
  known: '',
  ignored: 'opacity-40',
};

interface MarkdownReaderProps {
  lesson: Lesson;
  onWordClick: (word: string, sentence: string) => void;
  onClose: () => void;
  refreshTrigger?: number;
  prevLesson?: LessonSummary | null;
  nextLesson?: LessonSummary | null;
}

export default function MarkdownReader({
  lesson,
  onWordClick,
  onClose,
  refreshTrigger = 0,
  prevLesson,
  nextLesson,
}: MarkdownReaderProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [knownWordsMap, setKnownWordsMap] = useState<Map<string, WordState>>(new Map());
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [scrollPercentage, setScrollPercentage] = useState(0);

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
    const wordPattern = /['''ʼ`]n\b|[\wêëéèôöûüîïáà]+/gi;
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

    const colors = isDarkMode ? darkStateColors : stateColors;

    return parts.map((part, i) => {
      if (part.isWord) {
        const state = getWordState(part.text);
        const colorClass = state ? colors[state] : colors.new;

        return (
          <span
            key={i}
            onClick={(e) => {
              const sentence = findSentence(e.currentTarget);
              onWordClick(part.text, sentence);
            }}
            className={`cursor-pointer rounded px-0.5 hover:ring-2 hover:ring-blue-400 ${colorClass}`}
          >
            {part.text}
          </span>
        );
      }
      return <span key={i}>{part.text}</span>;
    });
  };

  const content = lesson.textContent;

  // Handle text selection for phrases
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (selectedText && selectedText.includes(' ')) {
      const sentence = findSentence(selection.anchorNode?.parentElement as HTMLElement);
      selection.removeAllRanges();
      onWordClick(selectedText, sentence);
    }
  }, [onWordClick]);

  return (
    <div className="flex flex-col h-full bg-[#faf8f5] dark:bg-zinc-900">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700">
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-3 py-2 rounded-lg
            text-zinc-600 dark:text-zinc-400
            hover:bg-zinc-100 dark:hover:bg-zinc-800
            transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span className="hidden sm:inline">Back</span>
        </button>

        <h1 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-md">
          {lesson.title}
        </h1>

        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          {scrollPercentage}%
        </div>
      </header>

      {/* Content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onMouseUp={handleMouseUp}
        className="flex-1 overflow-auto"
      >
        <article className="max-w-[38em] mx-auto px-8 py-16 prose prose-zinc dark:prose-invert
          prose-p:text-2xl prose-p:leading-[1.9] prose-p:text-zinc-700 dark:prose-p:text-zinc-300
          prose-headings:font-sans prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100
          prose-li:text-xl prose-li:leading-relaxed"
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

        {/* Prev/Next navigation at bottom */}
        {(prevLesson || nextLesson) && (
          <div className="max-w-[38em] mx-auto px-8 pb-16 flex items-center justify-between gap-4">
            {prevLesson ? (
              <button
                onClick={() => router.push(`/read/${prevLesson.id}`)}
                className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm
                  text-zinc-600 dark:text-zinc-400
                  hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
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
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ) : <div />}
          </div>
        )}
      </div>
    </div>
  );
}
