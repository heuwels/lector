'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  type Book,
  type WordState,
  getKnownWordsMap,
  saveReadingPosition,
  getReadingPosition,
} from '@/lib/db';

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
  book: Book;
  onWordClick: (word: string, sentence: string) => void;
  onClose: () => void;
  refreshTrigger?: number;
}

export default function MarkdownReader({ book, onWordClick, onClose, refreshTrigger = 0 }: MarkdownReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [knownWordsMap, setKnownWordsMap] = useState<Map<string, WordState>>(new Map());
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [scrollPercentage, setScrollPercentage] = useState(0);

  // Detect dark mode
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Load known words map
  useEffect(() => {
    getKnownWordsMap().then(setKnownWordsMap);
  }, [refreshTrigger]);

  // Load saved scroll position
  useEffect(() => {
    getReadingPosition(book.id).then((pos) => {
      if (pos && containerRef.current) {
        const scrollTop = (pos.percentage / 100) * containerRef.current.scrollHeight;
        containerRef.current.scrollTop = scrollTop;
      }
    });
  }, [book.id]);

  // Save scroll position on scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const percentage = Math.round((scrollTop / (scrollHeight - clientHeight)) * 100) || 0;
    setScrollPercentage(percentage);
    saveReadingPosition(book.id, '', 0, percentage);
  }, [book.id]);

  const getWordState = (word: string): WordState | undefined => {
    return knownWordsMap.get(word.toLowerCase());
  };

  const findSentence = (element: HTMLElement): string => {
    let block = element.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6');
    return block?.textContent || '';
  };

  // Wrap words in clickable spans
  // Afrikaans word pattern: includes accented chars (ê, ë, ô, û, î, ï, á, é) and 'n
  const renderText = (text: string) => {
    // Split keeping words with accents and 'n together
    // Match: 'n (with straight or curly quotes), words with accents, or regular words
    const wordPattern = /['ʼ''`]n\b|[\wêëéèôöûüîïáà]+/gi;
    const parts: { text: string; isWord: boolean }[] = [];
    let lastIndex = 0;
    let match;

    while ((match = wordPattern.exec(text)) !== null) {
      // Add any non-word text before this match
      if (match.index > lastIndex) {
        parts.push({ text: text.slice(lastIndex, match.index), isWord: false });
      }
      // Add the word
      parts.push({ text: match[0], isWord: true });
      lastIndex = match.index + match[0].length;
    }
    // Add any remaining text
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

  const content = book.textContent || new TextDecoder().decode(book.fileData);

  return (
    <div className="flex flex-col h-full bg-[#fefefe] dark:bg-zinc-900">
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
          {book.title}
        </h1>

        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          {scrollPercentage}%
        </div>
      </header>

      {/* Content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto"
      >
        <article className="max-w-[32em] mx-auto px-8 py-12 prose prose-zinc dark:prose-invert
          prose-p:text-2xl prose-p:leading-relaxed prose-p:text-zinc-700 dark:prose-p:text-zinc-300
          prose-headings:font-sans prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100
          prose-li:text-xl prose-li:leading-relaxed">
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
      </div>
    </div>
  );
}
