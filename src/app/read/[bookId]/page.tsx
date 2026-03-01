'use client';

import { useEffect, useState, useCallback, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Reader from '@/components/Reader';
import MarkdownReader from '@/components/MarkdownReader';
import {
  type Book,
  type VocabEntry,
  getBook,
  saveVocab,
  getVocabByText,
  updateVocabState,
  incrementDailyStat,
} from '@/lib/db';
import { translateWord, translatePhrase } from '@/lib/claude';
import { lookupWord } from '@/lib/dictionary';
import { v4 as uuidv4 } from 'uuid';

interface WordPanelState {
  isOpen: boolean;
  word: string;
  sentence: string;
  translation: string | null;
  partOfSpeech: string | null;
  isLoading: boolean;
  error: string | null;
  existingEntry: VocabEntry | null;
}

export default function ReadPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = use(params);
  const router = useRouter();

  const [book, setBook] = useState<Book | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readerRefreshTrigger, setReaderRefreshTrigger] = useState(0);
  const wordPanelRef = useRef<HTMLDivElement>(null);

  const [wordPanel, setWordPanel] = useState<WordPanelState>({
    isOpen: false,
    word: '',
    sentence: '',
    translation: null,
    partOfSpeech: null,
    isLoading: false,
    error: null,
    existingEntry: null,
  });

  // Load book from IndexedDB
  useEffect(() => {
    async function loadBook() {
      try {
        setIsLoading(true);
        const loadedBook = await getBook(bookId);

        if (!loadedBook) {
          setError('Book not found');
          return;
        }

        setBook(loadedBook);
      } catch (err) {
        console.error('Error loading book:', err);
        setError(err instanceof Error ? err.message : 'Failed to load book');
      } finally {
        setIsLoading(false);
      }
    }

    loadBook();
  }, [bookId]);

  // Handle word click from reader
  const handleWordClick = useCallback(async (word: string, sentence: string) => {
    const isPhrase = word.includes(' ');

    // Check if word/phrase already exists in vocab
    const existingEntry = await getVocabByText(word.toLowerCase());
    const hasTranslation = existingEntry?.translation && existingEntry.translation.length > 0;

    setWordPanel({
      isOpen: true,
      word,
      sentence,
      translation: hasTranslation ? existingEntry.translation : null,
      partOfSpeech: isPhrase ? 'phrase' : null,
      isLoading: !hasTranslation,
      error: null,
      existingEntry: existingEntry || null,
    });

    // Track lookup
    await incrementDailyStat('dictionaryLookups');

    // If no existing translation, check dictionary first (for single words), then fall back to API
    if (!hasTranslation) {
      if (isPhrase) {
        // Phrases always use the API
        try {
          const result = await translatePhrase(word, sentence);
          setWordPanel((prev) => ({
            ...prev,
            translation: result.translation,
            partOfSpeech: 'phrase',
            isLoading: false,
          }));
        } catch (err) {
          console.error('Phrase translation error:', err);
          setWordPanel((prev) => ({
            ...prev,
            isLoading: false,
            error: 'Failed to translate phrase. Check API key in settings.',
          }));
        }
      } else {
        // Single word - check local dictionary first
        const dictionaryEntry = lookupWord(word);

        if (dictionaryEntry) {
          // Found in dictionary - use it immediately (no API call needed)
          setWordPanel((prev) => ({
            ...prev,
            translation: dictionaryEntry.translation,
            partOfSpeech: dictionaryEntry.partOfSpeech || null,
            isLoading: false,
          }));
        } else {
          // Not in dictionary - fall back to Claude API
          try {
            const result = await translateWord(word, sentence);
            setWordPanel((prev) => ({
              ...prev,
              translation: result.translation,
              partOfSpeech: result.partOfSpeech || null,
              isLoading: false,
            }));
          } catch (err) {
            console.error('Translation error:', err);
            setWordPanel((prev) => ({
              ...prev,
              isLoading: false,
              error: 'Failed to translate word. Add ANTHROPIC_API_KEY to settings for uncommon words.',
            }));
          }
        }
      }
    }
  }, []);

  // Close word panel
  const closeWordPanel = useCallback(() => {
    setWordPanel((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Save word to vocabulary
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
      bookId: bookId,
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
    setReaderRefreshTrigger(prev => prev + 1); // Refresh reader highlighting
  }, [wordPanel, bookId]);

  // Mark word as known
  const markAsKnown = useCallback(async () => {
    let entryId = wordPanel.existingEntry?.id;

    if (!entryId) {
      // No existing entry - create one first
      const newId = uuidv4();
      const entry: VocabEntry = {
        id: newId,
        text: wordPanel.word.toLowerCase(),
        type: 'word',
        sentence: wordPanel.sentence,
        translation: wordPanel.translation || '',
        state: 'known', // Set directly to known
        stateUpdatedAt: new Date(),
        reviewCount: 0,
        bookId: bookId,
        createdAt: new Date(),
        pushedToAnki: false,
      };
      await saveVocab(entry);
      entryId = newId;
    } else {
      // Update existing entry to known
      await updateVocabState(entryId, 'known');
    }

    await incrementDailyStat('wordsMarkedKnown');
    setReaderRefreshTrigger(prev => prev + 1); // Refresh reader highlighting
    closeWordPanel();
  }, [wordPanel, bookId, closeWordPanel]);

  // Ignore word (proper nouns, etc)
  const ignoreWord = useCallback(async () => {
    if (!wordPanel.existingEntry) {
      // Save as ignored
      const entry: VocabEntry = {
        id: uuidv4(),
        text: wordPanel.word.toLowerCase(),
        type: 'word',
        sentence: wordPanel.sentence,
        translation: wordPanel.translation || '',
        state: 'ignored',
        stateUpdatedAt: new Date(),
        reviewCount: 0,
        bookId: bookId,
        createdAt: new Date(),
        pushedToAnki: false,
      };
      await saveVocab(entry);
    } else {
      await updateVocabState(wordPanel.existingEntry.id, 'ignored');
    }

    setReaderRefreshTrigger(prev => prev + 1); // Refresh reader highlighting
    closeWordPanel();
  }, [wordPanel, bookId, closeWordPanel]);

  // Handle close
  const handleClose = useCallback(() => {
    router.push('/');
  }, [router]);

  // Focus word panel and handle keyboard when it opens
  useEffect(() => {
    if (!wordPanel.isOpen) return;

    // Focus the panel
    wordPanelRef.current?.focus();

    // Also add window listener in capture phase to stop propagation
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
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [wordPanel.isOpen, wordPanel.existingEntry, wordPanel.translation, closeWordPanel, markAsKnown, ignoreWord, saveWordToVocab]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white dark:bg-zinc-900">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-600 dark:text-zinc-400">Loading book...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !book) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white dark:bg-zinc-900 p-8">
        <div className="text-red-500 dark:text-red-400 text-xl mb-4">
          {error || 'Book not found'}
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
    <div className="h-screen flex flex-col bg-white dark:bg-zinc-900">
      {/* Reader */}
      <div className="flex-1 relative overflow-hidden">
        {book.fileType === 'markdown' ? (
          <MarkdownReader book={book} onWordClick={handleWordClick} onClose={handleClose} refreshTrigger={readerRefreshTrigger} />
        ) : book.fileType === 'pdf' ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            PDF support coming soon
          </div>
        ) : (
          <Reader book={book} onWordClick={handleWordClick} onClose={handleClose} refreshTrigger={readerRefreshTrigger} />
        )}
      </div>

      {/* Compact word translation bar */}
      {wordPanel.isOpen && (
        <div
          ref={wordPanelRef}
          tabIndex={-1}
          className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-zinc-800
            border-t border-zinc-200 dark:border-zinc-700 shadow-lg outline-none">
          <div className="max-w-3xl mx-auto px-4 py-3">
            <div className="flex items-center gap-4">
              {/* Word and translation */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                    {wordPanel.word}
                  </span>
                  {wordPanel.partOfSpeech && (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 italic">
                      {wordPanel.partOfSpeech}
                    </span>
                  )}
                  <span className="text-zinc-400 dark:text-zinc-500">→</span>
                  {wordPanel.isLoading ? (
                    <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                      <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </span>
                  ) : wordPanel.error ? (
                    <span className="text-red-500 dark:text-red-400 text-sm">{wordPanel.error}</span>
                  ) : (
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {wordPanel.translation || '—'}
                    </span>
                  )}
                </div>
                {wordPanel.existingEntry && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {wordPanel.existingEntry.state}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                {!wordPanel.existingEntry && wordPanel.translation && (
                  <button
                    onClick={saveWordToVocab}
                    className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded
                      hover:bg-blue-600 transition-colors font-medium"
                    title="Save (S)"
                  >
                    Save
                  </button>
                )}
                <button
                  onClick={markAsKnown}
                  className="px-3 py-1.5 text-sm bg-green-500 text-white rounded
                    hover:bg-green-600 transition-colors font-medium"
                  title="Known (K)"
                >
                  Known
                </button>
                <button
                  onClick={ignoreWord}
                  className="px-3 py-1.5 text-sm bg-zinc-200 dark:bg-zinc-700 rounded
                    hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors
                    text-zinc-700 dark:text-zinc-300"
                  title="Ignore (X)"
                >
                  Ignore
                </button>
                <button
                  onClick={closeWordPanel}
                  className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                  title="Close (Esc)"
                >
                  <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
