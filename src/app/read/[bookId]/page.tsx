'use client';

import { useEffect, useState, useCallback, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import MarkdownReader from '@/components/MarkdownReader';
import {
  type Lesson,
  type LessonSummary,
  type VocabEntry,
  getLesson,
  getLessonsForCollection,
  saveVocab,
  getVocabByText,
  updateVocabState,
  incrementDailyStat,
} from '@/lib/data-layer';
import { translateWord, translatePhrase } from '@/lib/claude';
import { lookupWord } from '@/lib/dictionary';
import { speak } from '@/lib/tts';
import { v4 as uuidv4 } from 'uuid';

interface WordPanelState {
  isOpen: boolean;
  word: string;
  sentence: string;
  translation: string | null;
  partOfSpeech: string | null;
  isLoading: boolean;
  isContextLoading: boolean;
  isDictionaryResult: boolean;
  error: string | null;
  existingEntry: VocabEntry | null;
}

export default function ReadPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId: lessonId } = use(params);
  const router = useRouter();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [siblings, setSiblings] = useState<LessonSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readerRefreshTrigger, setReaderRefreshTrigger] = useState(0);
  const wordPanelRef = useRef<HTMLDivElement>(null);
  const translationRequestId = useRef(0);

  const [wordPanel, setWordPanel] = useState<WordPanelState>({
    isOpen: false,
    word: '',
    sentence: '',
    translation: null,
    partOfSpeech: null,
    isLoading: false,
    isContextLoading: false,
    isDictionaryResult: false,
    error: null,
    existingEntry: null,
  });

  // Load lesson
  useEffect(() => {
    async function loadLesson() {
      try {
        setIsLoading(true);
        const loadedLesson = await getLesson(lessonId);

        if (!loadedLesson) {
          setError('Lesson not found');
          return;
        }

        setLesson(loadedLesson);

        // Load sibling lessons for prev/next navigation
        if (loadedLesson.collectionId) {
          const allLessons = await getLessonsForCollection(loadedLesson.collectionId);
          setSiblings(allLessons);
        }
      } catch (err) {
        console.error('Error loading lesson:', err);
        setError(err instanceof Error ? err.message : 'Failed to load lesson');
      } finally {
        setIsLoading(false);
      }
    }

    loadLesson();
  }, [lessonId]);

  // Handle word click from reader
  const handleWordClick = useCallback(async (word: string, sentence: string) => {
    const isPhrase = word.includes(' ');
    const requestId = ++translationRequestId.current;

    const wordsToSpeak = word.split(/\s+/).slice(0, 15).join(' ');
    speak(wordsToSpeak);

    const existingEntry = await getVocabByText(word.toLowerCase());
    const hasTranslation = existingEntry?.translation && existingEntry.translation.length > 0;

    setWordPanel({
      isOpen: true,
      word,
      sentence,
      translation: hasTranslation ? existingEntry.translation : null,
      partOfSpeech: isPhrase ? 'phrase' : null,
      isLoading: !hasTranslation,
      isContextLoading: false,
      isDictionaryResult: false,
      error: null,
      existingEntry: existingEntry || null,
    });

    await incrementDailyStat('dictionaryLookups');

    if (!hasTranslation) {
      if (isPhrase) {
        try {
          const result = await translatePhrase(word, sentence);
          if (requestId !== translationRequestId.current) return;
          setWordPanel((prev) => ({
            ...prev,
            translation: result.translation,
            partOfSpeech: 'phrase',
            isLoading: false,
          }));
        } catch (err) {
          if (requestId !== translationRequestId.current) return;
          console.error('Phrase translation error:', err);
          setWordPanel((prev) => ({
            ...prev,
            isLoading: false,
            error: 'Failed to translate phrase. Check AI provider in settings.',
          }));
        }
      } else {
        const dictionaryEntry = lookupWord(word);

        if (dictionaryEntry) {
          setWordPanel((prev) => ({
            ...prev,
            translation: dictionaryEntry.translation,
            partOfSpeech: dictionaryEntry.partOfSpeech || null,
            isLoading: false,
            isDictionaryResult: true,
          }));
        } else {
          try {
            const result = await translateWord(word, sentence);
            if (requestId !== translationRequestId.current) return;
            setWordPanel((prev) => ({
              ...prev,
              translation: result.translation,
              partOfSpeech: result.partOfSpeech || null,
              isLoading: false,
            }));
          } catch (err) {
            if (requestId !== translationRequestId.current) return;
            console.error('Translation error:', err);
            setWordPanel((prev) => ({
              ...prev,
              isLoading: false,
              error: 'Failed to translate word. Check AI provider in settings.',
            }));
          }
        }
      }
    }
  }, []);

  const closeWordPanel = useCallback(() => {
    setWordPanel((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const requestContextTranslation = useCallback(async () => {
    setWordPanel((prev) => ({ ...prev, isContextLoading: true }));
    try {
      const result = await translateWord(wordPanel.word, wordPanel.sentence);
      setWordPanel((prev) => ({
        ...prev,
        translation: result.translation,
        partOfSpeech: result.partOfSpeech || prev.partOfSpeech,
        isContextLoading: false,
        isDictionaryResult: false,
      }));
    } catch (err) {
      console.error('Context translation error:', err);
      setWordPanel((prev) => ({
        ...prev,
        isContextLoading: false,
        isDictionaryResult: false,
        error: 'Failed to get contextual translation.',
      }));
    }
  }, [wordPanel.word, wordPanel.sentence]);

  const saveWordToVocab = useCallback(async () => {
    if (!wordPanel.translation) return;

    const isPhrase = wordPanel.word.includes(' ');
    const entry: VocabEntry = {
      id: wordPanel.existingEntry?.id || uuidv4(),
      text: wordPanel.word.toLowerCase(),
      type: isPhrase ? 'phrase' : 'word',
      sentence: wordPanel.sentence,
      translation: wordPanel.translation,
      state: wordPanel.existingEntry?.state || 'level1',
      stateUpdatedAt: new Date(),
      reviewCount: wordPanel.existingEntry?.reviewCount || 0,
      bookId: lessonId,
      createdAt: wordPanel.existingEntry?.createdAt || new Date(),
      pushedToAnki: wordPanel.existingEntry?.pushedToAnki || false,
      ankiNoteId: wordPanel.existingEntry?.ankiNoteId,
    };

    await saveVocab(entry);
    await incrementDailyStat('newWordsSaved');

    setWordPanel((prev) => ({
      ...prev,
      existingEntry: entry,
    }));
    setReaderRefreshTrigger(prev => prev + 1);
  }, [wordPanel, lessonId]);

  const markAsKnown = useCallback(async () => {
    let entryId = wordPanel.existingEntry?.id;

    if (!entryId) {
      const newId = uuidv4();
      const entry: VocabEntry = {
        id: newId,
        text: wordPanel.word.toLowerCase(),
        type: 'word',
        sentence: wordPanel.sentence,
        translation: wordPanel.translation || '',
        state: 'known',
        stateUpdatedAt: new Date(),
        reviewCount: 0,
        bookId: lessonId,
        createdAt: new Date(),
        pushedToAnki: false,
      };
      await saveVocab(entry);
      entryId = newId;
    } else {
      await updateVocabState(entryId, 'known');
    }

    await incrementDailyStat('wordsMarkedKnown');
    setReaderRefreshTrigger(prev => prev + 1);
    closeWordPanel();
  }, [wordPanel, lessonId, closeWordPanel]);

  const ignoreWord = useCallback(async () => {
    if (!wordPanel.existingEntry) {
      const entry: VocabEntry = {
        id: uuidv4(),
        text: wordPanel.word.toLowerCase(),
        type: 'word',
        sentence: wordPanel.sentence,
        translation: wordPanel.translation || '',
        state: 'ignored',
        stateUpdatedAt: new Date(),
        reviewCount: 0,
        bookId: lessonId,
        createdAt: new Date(),
        pushedToAnki: false,
      };
      await saveVocab(entry);
    } else {
      await updateVocabState(wordPanel.existingEntry.id, 'ignored');
    }

    setReaderRefreshTrigger(prev => prev + 1);
    closeWordPanel();
  }, [wordPanel, lessonId, closeWordPanel]);

  const setWordLevel = useCallback(async (level: 1 | 2 | 3 | 4) => {
    if (!wordPanel.translation) return;

    const state = `level${level}` as 'level1' | 'level2' | 'level3' | 'level4';

    if (!wordPanel.existingEntry) {
      const entry: VocabEntry = {
        id: uuidv4(),
        text: wordPanel.word.toLowerCase(),
        type: wordPanel.word.includes(' ') ? 'phrase' : 'word',
        sentence: wordPanel.sentence,
        translation: wordPanel.translation,
        state,
        stateUpdatedAt: new Date(),
        reviewCount: 0,
        bookId: lessonId,
        createdAt: new Date(),
        pushedToAnki: false,
      };
      await saveVocab(entry);
      await incrementDailyStat('newWordsSaved');
      setWordPanel((prev) => ({ ...prev, existingEntry: entry }));
    } else {
      await updateVocabState(wordPanel.existingEntry.id, state);
      setWordPanel((prev) => ({
        ...prev,
        existingEntry: prev.existingEntry ? { ...prev.existingEntry, state } : null,
      }));
    }

    setReaderRefreshTrigger(prev => prev + 1);
  }, [wordPanel, lessonId]);

  const handleClose = useCallback(() => {
    if (lesson?.collectionId) {
      router.push(`/collection/${lesson.collectionId}`);
    } else {
      router.push('/');
    }
  }, [router, lesson]);

  // Navigate to prev/next lesson in collection
  const currentIndex = siblings.findIndex(l => l.id === lessonId);
  const prevLesson = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const nextLesson = currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

  // Focus word panel and handle keyboard when it opens
  useEffect(() => {
    if (!wordPanel.isOpen) return;

    wordPanelRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'escape') {
        e.preventDefault();
        e.stopPropagation();
        closeWordPanel();
      } else if (key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        markAsKnown();
      } else if (key === 'x') {
        e.preventDefault();
        e.stopPropagation();
        ignoreWord();
      } else if (key === 's' && !wordPanel.existingEntry && wordPanel.translation) {
        e.preventDefault();
        e.stopPropagation();
        saveWordToVocab();
      } else if (['1', '2', '3', '4'].includes(e.key) && wordPanel.translation) {
        e.preventDefault();
        e.stopPropagation();
        setWordLevel(parseInt(e.key) as 1 | 2 | 3 | 4);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [wordPanel.isOpen, wordPanel.existingEntry, wordPanel.translation, closeWordPanel, markAsKnown, ignoreWord, saveWordToVocab, setWordLevel]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white dark:bg-zinc-900">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-600 dark:text-zinc-400">Loading lesson...</p>
        </div>
      </div>
    );
  }

  if (error || !lesson) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white dark:bg-zinc-900 p-8">
        <div className="text-red-500 dark:text-red-400 text-xl mb-4">
          {error || 'Lesson not found'}
        </div>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg
            hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors
            text-zinc-900 dark:text-zinc-100"
        >
          Go to Library
        </button>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-white dark:bg-zinc-900 overflow-x-hidden">
      {/* Reader */}
      <div className="flex-1 relative overflow-hidden">
        <MarkdownReader
          lesson={lesson}
          onWordClick={handleWordClick}
          onClose={handleClose}
          refreshTrigger={readerRefreshTrigger}
          prevLesson={prevLesson}
          nextLesson={nextLesson}
        />
      </div>

      {/* Compact word translation bar */}
      {wordPanel.isOpen && (
        <div
          ref={wordPanelRef}
          tabIndex={-1}
          className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-zinc-800
            border-t border-zinc-200 dark:border-zinc-700 shadow-lg outline-none">
          <div className="max-w-3xl mx-auto px-3 sm:px-4 py-2 sm:py-3">
            {/* Row 1: Word, translation, close button */}
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                    {wordPanel.word}
                  </span>
                  <button
                    onClick={() => {
                      const words = wordPanel.word.split(/\s+/).slice(0, 15);
                      speak(words.join(' '));
                    }}
                    className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    title="Listen to word"
                  >
                    <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  </button>
                  {wordPanel.partOfSpeech && (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 italic">
                      {wordPanel.partOfSpeech}
                    </span>
                  )}
                  <span className="text-zinc-400 dark:text-zinc-500">&rarr;</span>
                  {wordPanel.isLoading ? (
                    <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                      <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </span>
                  ) : wordPanel.error ? (
                    <span className="text-red-500 dark:text-red-400 text-sm">{wordPanel.error}</span>
                  ) : (
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {wordPanel.translation || '\u2014'}
                    </span>
                  )}
                  {wordPanel.isDictionaryResult && !wordPanel.isContextLoading && (
                    <button
                      onClick={requestContextTranslation}
                      className="ml-1 px-2 py-0.5 text-xs font-medium rounded-md
                        bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400
                        hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                      title="Translate using AI with sentence context"
                    >
                      In context
                    </button>
                  )}
                  {wordPanel.isContextLoading && (
                    <span className="ml-1 flex items-center gap-1 text-xs text-indigo-500">
                      <span className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    </span>
                  )}
                </div>
                {wordPanel.existingEntry && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {wordPanel.existingEntry.state}
                  </div>
                )}
                {/* Sentence with speaker button */}
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    {wordPanel.sentence}
                  </span>
                  <button
                    onClick={() => {
                      const words = wordPanel.sentence.split(/\s+/).slice(0, 15);
                      speak(words.join(' '));
                    }}
                    className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors flex-shrink-0"
                    title="Listen to sentence"
                  >
                    <svg className="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  </button>
                </div>
              </div>
              <button
                onClick={closeWordPanel}
                className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors flex-shrink-0"
                title="Close (Esc)"
              >
                <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Row 2: Level buttons + action buttons */}
            <div className="flex items-center gap-2 mt-2">
              {wordPanel.translation && (
                <div className="flex items-center gap-1 border-r border-zinc-200 dark:border-zinc-600 pr-2 mr-1">
                  {[1, 2, 3, 4].map((level) => {
                    const currentLevel = wordPanel.existingEntry?.state;
                    const isActive = currentLevel === `level${level}`;
                    const colors = {
                      1: 'bg-blue-500 hover:bg-blue-600',
                      2: 'bg-blue-400 hover:bg-blue-500',
                      3: 'bg-blue-300 hover:bg-blue-400',
                      4: 'bg-blue-200 hover:bg-blue-300',
                    };
                    return (
                      <button
                        key={level}
                        onClick={() => setWordLevel(level as 1 | 2 | 3 | 4)}
                        className={`w-7 h-7 text-sm font-bold rounded transition-all
                          ${isActive
                            ? `${colors[level as keyof typeof colors]} text-white ring-2 ring-offset-1 ring-blue-500`
                            : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                          }`}
                        title={`Level ${level}`}
                      >
                        {level}
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                onClick={markAsKnown}
                className={`px-3 py-1.5 text-sm rounded transition-colors font-medium
                  ${wordPanel.existingEntry?.state === 'known'
                    ? 'bg-green-500 text-white ring-2 ring-offset-1 ring-green-500'
                    : 'bg-green-500 text-white hover:bg-green-600'
                  }`}
                title="Known (K)"
              >
                &#10003;
              </button>
              <button
                onClick={ignoreWord}
                className={`px-3 py-1.5 text-sm rounded transition-colors
                  ${wordPanel.existingEntry?.state === 'ignored'
                    ? 'bg-zinc-400 text-white ring-2 ring-offset-1 ring-zinc-400'
                    : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                  }`}
                title="Ignore (X)"
              >
                &#10005;
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
