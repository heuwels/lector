'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { WordState } from '@/lib/db';

interface SentenceModeReaderProps {
  sentences: string[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onWordClick: (word: string, sentence: string) => void;
  getWordState: (word: string) => WordState | undefined;
}

// Color mapping for word states - background highlights
const stateColors: Record<WordState, string> = {
  new: 'bg-blue-100 dark:bg-blue-900/40',
  level1: 'bg-yellow-200 dark:bg-yellow-700/50',
  level2: 'bg-yellow-100 dark:bg-yellow-800/30',
  level3: 'bg-yellow-50 dark:bg-yellow-900/20',
  level4: '',
  known: '',
  ignored: 'opacity-50',
};

export default function SentenceModeReader({
  sentences,
  currentIndex,
  onIndexChange,
  onWordClick,
  getWordState,
}: SentenceModeReaderProps) {
  const [isTransitioning, setIsTransitioning] = useState(false);

  const currentSentence = sentences[currentIndex] || '';

  // Parse sentence into words while preserving punctuation
  // Handles Afrikaans: 'n (any quote style), accented chars (ê, ë, ô, û, î, ï, á, é)
  const tokens = useMemo(() => {
    const result: string[] = [];
    const wordPattern = /['ʼ''`]n\b|[\wêëéèôöûüîïáà]+/gi;
    let lastIndex = 0;
    let match;

    while ((match = wordPattern.exec(currentSentence)) !== null) {
      // Add any non-word text before this match
      if (match.index > lastIndex) {
        const between = currentSentence.slice(lastIndex, match.index);
        if (between) result.push(between);
      }
      result.push(match[0]);
      lastIndex = match.index + match[0].length;
    }
    // Add remaining text
    if (lastIndex < currentSentence.length) {
      result.push(currentSentence.slice(lastIndex));
    }
    return result.filter(Boolean);
  }, [currentSentence]);

  const handlePrevSentence = useCallback(() => {
    if (currentIndex > 0) {
      setIsTransitioning(true);
      setTimeout(() => {
        onIndexChange(currentIndex - 1);
        setIsTransitioning(false);
      }, 150);
    }
  }, [currentIndex, onIndexChange]);

  const handleNextSentence = useCallback(() => {
    if (currentIndex < sentences.length - 1) {
      setIsTransitioning(true);
      setTimeout(() => {
        onIndexChange(currentIndex + 1);
        setIsTransitioning(false);
      }, 150);
    }
  }, [currentIndex, sentences.length, onIndexChange]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        handlePrevSentence();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        handleNextSentence();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrevSentence, handleNextSentence]);

  const handleWordClick = useCallback(
    (word: string) => {
      // Clean the word (keep accented chars, remove other punctuation)
      const cleanWord = word.replace(/[^\wêëéèôöûüîïáà']/gi, '').trim();
      if (cleanWord) {
        onWordClick(cleanWord, currentSentence);
      }
    },
    [onWordClick, currentSentence]
  );

  // Check if token is a word (including Afrikaans 'n and accented chars)
  const isWord = (token: string) => /^['ʼ''`]n$/i.test(token) || /[\wêëéèôöûüîïáà]/i.test(token);

  return (
    <div className="flex flex-col h-full">
      {/* Progress indicator */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-700">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          Sentence {currentIndex + 1} of {sentences.length}
        </span>
        <div className="flex-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / sentences.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Sentence display */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div
          className={`max-w-2xl text-center transition-opacity duration-150 ${
            isTransitioning ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <p className="text-2xl md:text-3xl leading-relaxed text-zinc-900 dark:text-zinc-100">
            {tokens.map((token, i) => {
              if (!isWord(token)) {
                // Whitespace or punctuation
                return (
                  <span key={i} className="whitespace-pre-wrap">
                    {token}
                  </span>
                );
              }

              // It's a word - check state and make clickable
              const cleanWord = token.replace(/[^\w]/g, '').toLowerCase();
              const state = getWordState(cleanWord);
              const colorClass = state ? stateColors[state] : stateColors.new;

              return (
                <span
                  key={i}
                  onClick={() => handleWordClick(token)}
                  className={`cursor-pointer rounded px-1 py-0.5
                    hover:ring-2 hover:ring-blue-400 dark:hover:ring-blue-500
                    transition-all ${colorClass}`}
                >
                  {token}
                </span>
              );
            })}
          </p>
        </div>
      </div>

      {/* Navigation controls */}
      <div className="flex items-center justify-center gap-4 p-4 border-t border-zinc-200 dark:border-zinc-700">
        <button
          onClick={handlePrevSentence}
          disabled={currentIndex === 0}
          className="flex items-center gap-2 px-6 py-3 rounded-lg
            bg-zinc-100 dark:bg-zinc-800
            text-zinc-700 dark:text-zinc-300
            hover:bg-zinc-200 dark:hover:bg-zinc-700
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="hidden sm:inline">Previous</span>
        </button>

        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          Press <kbd className="px-2 py-1 bg-zinc-200 dark:bg-zinc-700 rounded text-xs">Space</kbd> or{' '}
          <kbd className="px-2 py-1 bg-zinc-200 dark:bg-zinc-700 rounded text-xs">Arrow Keys</kbd> to navigate
        </div>

        <button
          onClick={handleNextSentence}
          disabled={currentIndex === sentences.length - 1}
          className="flex items-center gap-2 px-6 py-3 rounded-lg
            bg-blue-500 dark:bg-blue-600
            text-white
            hover:bg-blue-600 dark:hover:bg-blue-700
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors"
        >
          <span className="hidden sm:inline">Next</span>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
