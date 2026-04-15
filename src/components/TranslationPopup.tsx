'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { WordState } from '@/types';
import { speak } from '@/lib/tts';

// Color mapping for word states
const wordStateColors: Record<WordState, { bg: string; text: string; dot: string }> = {
  'new': { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500' },
  'level1': { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' },
  'level2': { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500' },
  'level3': { bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-500' },
  'level4': { bg: 'bg-lime-100 dark:bg-lime-900/40', text: 'text-lime-700 dark:text-lime-300', dot: 'bg-lime-500' },
  'known': { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-500' },
  'ignored': { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', dot: 'bg-gray-400' },
};

const wordStateLabels: Record<WordState, string> = {
  'new': 'New',
  'level1': 'Level 1',
  'level2': 'Level 2',
  'level3': 'Level 3',
  'level4': 'Level 4',
  'known': 'Known',
  'ignored': 'Ignored',
};

interface TranslationPopupProps {
  word: string;
  sentence: string;
  translation: string;
  partOfSpeech?: string;
  currentState: WordState;
  position: { x: number; y: number };
  onClose: () => void;
  onStateChange: (state: WordState) => void;
  onSaveToVocab: () => void;
  onAddToAnki: (cardType: 'basic' | 'cloze') => void;
}

export default function TranslationPopup({
  word,
  sentence,
  translation,
  partOfSpeech,
  currentState,
  position,
  onClose,
  onStateChange,
  onSaveToVocab,
  onAddToAnki,
}: TranslationPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [ankiCardType, setAnkiCardType] = useState<'basic' | 'cloze'>('basic');
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [isVisible, setIsVisible] = useState(false);

  // Adjust position to keep popup within viewport
  useEffect(() => {
    if (!popupRef.current) return;

    const popup = popupRef.current;
    const rect = popup.getBoundingClientRect();
    const padding = 16;

    let newX = position.x;
    let newY = position.y;

    // Adjust horizontal position
    if (position.x + rect.width > window.innerWidth - padding) {
      newX = window.innerWidth - rect.width - padding;
    }
    if (newX < padding) {
      newX = padding;
    }

    // Adjust vertical position - prefer below the word, but flip if needed
    if (position.y + rect.height > window.innerHeight - padding) {
      // Position above the click point instead
      newY = position.y - rect.height - 20;
    }
    if (newY < padding) {
      newY = padding;
    }

    setAdjustedPosition({ x: newX, y: newY }); // eslint-disable-line react-hooks/set-state-in-effect -- position calc

    // Trigger entrance animation
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, [position]);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Delay adding listener to prevent immediate close from the same click
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSpeak = useCallback(() => {
    speak(word);
  }, [word]);

  const handleSpeakSentence = useCallback(() => {
    speak(sentence);
  }, [sentence]);

  const stateColors = wordStateColors[currentState];

  const levelButtons: WordState[] = ['level1', 'level2', 'level3', 'level4'];

  const popupContent = (
    <div
      ref={popupRef}
      className={`
        fixed z-50 w-80 max-w-[calc(100vw-32px)]
        bg-white dark:bg-zinc-900
        rounded-xl shadow-2xl
        border border-zinc-200 dark:border-zinc-700
        overflow-hidden
        transition-all duration-200 ease-out
        ${isVisible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'}
      `}
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      {/* Header with word and TTS */}
      <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {/* State indicator dot */}
            <span
              className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${stateColors.dot}`}
              title={wordStateLabels[currentState]}
            />

            {/* Word */}
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {word}
            </h3>

            {/* Part of speech badge */}
            {partOfSpeech && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                {partOfSpeech}
              </span>
            )}
          </div>

          {/* TTS button */}
          <button
            onClick={handleSpeak}
            className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors flex-shrink-0"
            title="Hear pronunciation"
            aria-label="Hear pronunciation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          </button>
        </div>

        {/* Current state badge */}
        <div className="mt-2">
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md ${stateColors.bg} ${stateColors.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${stateColors.dot}`} />
            {wordStateLabels[currentState]}
          </span>
        </div>
      </div>

      {/* Translation */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <p className="text-zinc-800 dark:text-zinc-200 leading-relaxed">
          {translation}
        </p>
      </div>

      {/* State change buttons */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex flex-wrap gap-2">
          {/* Level buttons */}
          <div className="flex gap-1">
            {levelButtons.map((level) => {
              const levelNum = level.replace('level', '');
              const colors = wordStateColors[level];
              const isActive = currentState === level;

              return (
                <button
                  key={level}
                  onClick={() => onStateChange(level)}
                  className={`
                    w-8 h-8 rounded-lg text-sm font-medium
                    transition-all duration-150
                    ${isActive
                      ? `${colors.bg} ${colors.text} ring-2 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900 ${colors.dot.replace('bg-', 'ring-')}`
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }
                  `}
                  title={`Set to Level ${levelNum}`}
                >
                  {levelNum}
                </button>
              );
            })}
          </div>

          {/* Known button */}
          <button
            onClick={() => onStateChange('known')}
            className={`
              px-3 h-8 rounded-lg text-sm font-medium
              transition-all duration-150
              ${currentState === 'known'
                ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 ring-2 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900 ring-green-500'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-green-50 dark:hover:bg-green-900/20 hover:text-green-700 dark:hover:text-green-300'
              }
            `}
          >
            Known
          </button>

          {/* Ignore button */}
          <button
            onClick={() => onStateChange('ignored')}
            className={`
              px-3 h-8 rounded-lg text-sm font-medium
              transition-all duration-150
              ${currentState === 'ignored'
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 ring-2 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900 ring-gray-400'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }
            `}
          >
            Ignore
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-4 py-3 space-y-2">
        {/* Save to Vocab */}
        <button
          onClick={onSaveToVocab}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          Save to Vocab
        </button>

        {/* Add to Anki with card type toggle */}
        <div className="flex gap-2">
          {/* Card type toggle */}
          <div className="flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5">
            <button
              onClick={() => setAnkiCardType('basic')}
              className={`
                px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-150
                ${ankiCardType === 'basic'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }
              `}
            >
              Basic
            </button>
            <button
              onClick={() => setAnkiCardType('cloze')}
              className={`
                px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-150
                ${ankiCardType === 'cloze'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }
              `}
            >
              Cloze
            </button>
          </div>

          {/* Add to Anki button */}
          <button
            onClick={() => onAddToAnki(ankiCardType)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add to Anki
          </button>
        </div>

        {/* Hear sentence button */}
        <button
          onClick={handleSpeakSentence}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
          Hear Sentence
        </button>
      </div>

      {/* Close button (X) in corner */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 p-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
        aria-label="Close"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );

  // Use portal to render at document root
  if (typeof window === 'undefined') {
    return null;
  }

  return createPortal(popupContent, document.body);
}
