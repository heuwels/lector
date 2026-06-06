'use client';

import { useEffect, useState, useCallback, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import MarkdownReader from '@/components/MarkdownReader';
import TranslationDrawer from '@/components/TranslationDrawer';
import {
  type Lesson,
  type LessonSummary,
  type VocabEntry,
  getLesson,
  getLessonsForCollection,
  saveVocab,
  getVocabByText,
  updateVocabState,
  updateLesson,
  incrementDailyStat,
} from '@/lib/data-layer';
import { translateWord, translatePhrase } from '@/lib/claude';
import { lookupWordRemote, type ExpandedDictionaryEntry } from '@/lib/dictionary-client';
import { speak } from '@/lib/tts';
import { v4 as uuidv4 } from 'uuid';

interface WordPanelState {
  isOpen: boolean;
  word: string;
  sentence: string;
  translation: string | null;
  partOfSpeech: string | null;
  dictEntry: ExpandedDictionaryEntry | null;
  /** Active AI-in-context override translation. When set, the drawer renders this
      instead of the dictionary senses, but vocab saves still prefer the dict's
      broader glosses (so a narrow contextual gloss like "pull" doesn't replace
      the canonical "pull/move/draw/journey/draught" entry). */
  aiContextTranslation: string | null;
  aiContextPartOfSpeech: string | null;
  phraseDetails: {
    literalBreakdown?: string;
    idiomaticMeaning?: string;
    usageNotes?: string;
    register?: string;
  } | null;
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
  const translationRequestId = useRef(0);
  const existingEntryLookup = useRef<Promise<VocabEntry | undefined> | null>(null);

  const [wordPanel, setWordPanel] = useState<WordPanelState>({
    isOpen: false,
    word: '',
    sentence: '',
    translation: null,
    partOfSpeech: null,
    dictEntry: null,
    aiContextTranslation: null,
    aiContextPartOfSpeech: null,
    phraseDetails: null,
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

    // Open popup immediately in loading state so keyboard shortcuts (K/X) are responsive
    setWordPanel({
      isOpen: true,
      word,
      sentence,
      translation: null,
      partOfSpeech: isPhrase ? 'phrase' : null,
      dictEntry: null,
      aiContextTranslation: null,
      aiContextPartOfSpeech: null,
      phraseDetails: null,
      isLoading: true,
      isContextLoading: false,
      isDictionaryResult: false,
      error: null,
      existingEntry: null,
    });

    incrementDailyStat('dictionaryLookups');

    const lookupPromise = getVocabByText(word.toLowerCase());
    existingEntryLookup.current = lookupPromise;
    const existingEntry = await lookupPromise;
    if (requestId !== translationRequestId.current) return;
    const hasTranslation = existingEntry?.translation && existingEntry.translation.length > 0;

    setWordPanel((prev) => ({
      ...prev,
      translation: hasTranslation ? existingEntry.translation : null,
      isLoading: !hasTranslation,
      existingEntry: existingEntry || null,
    }));

    if (!hasTranslation) {
      if (isPhrase) {
        try {
          const result = await translatePhrase(word, sentence);
          if (requestId !== translationRequestId.current) return;
          setWordPanel((prev) => ({
            ...prev,
            translation: result.translation,
            partOfSpeech: 'phrase',
            phraseDetails: {
              literalBreakdown: result.literalBreakdown,
              idiomaticMeaning: result.idiomaticMeaning,
              usageNotes: result.usageNotes,
              register: result.register,
            },
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
        // Try the on-device SQLite dictionary first (~90% hit rate)
        let dictEntry: ExpandedDictionaryEntry | null = null;
        try {
          dictEntry = await lookupWordRemote(word);
        } catch {
          dictEntry = null;
        }
        if (requestId !== translationRequestId.current) return;

        if (dictEntry && dictEntry.senses.length > 0) {
          // Stitch a single-string translation for vocab saves + keyboard hotkeys
          const translation = dictEntry.senses.map((s) => s.gloss).join('; ');
          setWordPanel((prev) => ({
            ...prev,
            translation,
            partOfSpeech: dictEntry!.senses[0]?.partOfSpeech || null,
            dictEntry,
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
              dictEntry: null,
              isLoading: false,
              isDictionaryResult: false,
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
      setWordPanel((prev) => {
        // When the dict already has the word: stash the AI gloss in the
        // override slot so the drawer renders it, but leave `translation`
        // (dict's joined senses) alone — that's what save handlers persist.
        // When the dict has no entry: the AI gloss IS the most authoritative
        // translation we have, so overwrite canonical too.
        if (prev.dictEntry) {
          return {
            ...prev,
            aiContextTranslation: result.translation,
            aiContextPartOfSpeech: result.partOfSpeech || null,
            isContextLoading: false,
          };
        }
        return {
          ...prev,
          translation: result.translation,
          partOfSpeech: result.partOfSpeech || prev.partOfSpeech,
          isContextLoading: false,
          isDictionaryResult: false,
        };
      });
    } catch (err) {
      console.error('Context translation error:', err);
      setWordPanel((prev) => ({
        ...prev,
        isContextLoading: false,
        error: 'Failed to get contextual translation.',
      }));
    }
  }, [wordPanel.word, wordPanel.sentence]);

  // Resolves the existing vocab entry, awaiting an in-flight lookup if needed.
  // Prevents duplicate-row races when the user acts before getVocabByText returns.
  const resolveExistingEntry = useCallback(async (): Promise<VocabEntry | undefined> => {
    if (wordPanel.existingEntry) return wordPanel.existingEntry;
    if (existingEntryLookup.current) {
      const fromLookup = await existingEntryLookup.current;
      if (fromLookup) return fromLookup;
    }
    return undefined;
  }, [wordPanel.existingEntry]);

  const saveWordToVocab = useCallback(async () => {
    if (!wordPanel.translation) return;

    const existing = await resolveExistingEntry();
    const isPhrase = wordPanel.word.includes(' ');
    const entry: VocabEntry = {
      id: existing?.id || uuidv4(),
      text: wordPanel.word.toLowerCase(),
      type: isPhrase ? 'phrase' : 'word',
      sentence: wordPanel.sentence,
      translation: wordPanel.translation,
      state: existing?.state || 'level1',
      stateUpdatedAt: new Date(),
      reviewCount: existing?.reviewCount || 0,
      bookId: lessonId,
      createdAt: existing?.createdAt || new Date(),
      pushedToAnki: existing?.pushedToAnki || false,
      ankiNoteId: existing?.ankiNoteId,
    };

    await saveVocab(entry);
    await incrementDailyStat('newWordsSaved');

    setWordPanel((prev) => ({
      ...prev,
      existingEntry: entry,
    }));
    setReaderRefreshTrigger(prev => prev + 1);
  }, [wordPanel, lessonId, resolveExistingEntry]);

  const markAsKnown = useCallback(async () => {
    const existing = await resolveExistingEntry();

    if (!existing) {
      const entry: VocabEntry = {
        id: uuidv4(),
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
    } else {
      await updateVocabState(existing.id, 'known');
    }

    await incrementDailyStat('wordsMarkedKnown');
    setReaderRefreshTrigger(prev => prev + 1);
    closeWordPanel();
  }, [wordPanel, lessonId, closeWordPanel, resolveExistingEntry]);

  const ignoreWord = useCallback(async () => {
    const existing = await resolveExistingEntry();

    if (!existing) {
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
      await updateVocabState(existing.id, 'ignored');
    }

    setReaderRefreshTrigger(prev => prev + 1);
    closeWordPanel();
  }, [wordPanel, lessonId, closeWordPanel, resolveExistingEntry]);

  const setWordLevel = useCallback(async (level: 1 | 2 | 3 | 4) => {
    if (!wordPanel.translation) return;

    const state = `level${level}` as 'level1' | 'level2' | 'level3' | 'level4';
    const existing = await resolveExistingEntry();

    if (!existing) {
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
      await updateVocabState(existing.id, state);
      setWordPanel((prev) => ({
        ...prev,
        existingEntry: prev.existingEntry ? { ...prev.existingEntry, state } : { ...existing, state },
      }));
    }

    setReaderRefreshTrigger(prev => prev + 1);
  }, [wordPanel, lessonId, resolveExistingEntry]);

  const handleClose = useCallback(() => {
    if (lesson?.collectionId) {
      router.push(`/collection/${lesson.collectionId}`);
    } else {
      router.push('/');
    }
  }, [router, lesson]);

  const retranslateWithAi = useCallback(async () => {
    setWordPanel((prev) => ({ ...prev, isLoading: true, error: null }));
    const isPhrase = wordPanel.word.includes(' ');
    try {
      if (isPhrase) {
        const result = await translatePhrase(wordPanel.word, wordPanel.sentence);
        setWordPanel((prev) => ({
          ...prev,
          translation: result.translation,
          partOfSpeech: 'phrase',
          dictEntry: null,
          phraseDetails: {
            literalBreakdown: result.literalBreakdown,
            idiomaticMeaning: result.idiomaticMeaning,
            usageNotes: result.usageNotes,
            register: result.register,
          },
          isLoading: false,
          isDictionaryResult: false,
        }));
      } else {
        const result = await translateWord(wordPanel.word, wordPanel.sentence);
        setWordPanel((prev) => ({
          ...prev,
          translation: result.translation,
          partOfSpeech: result.partOfSpeech || null,
          dictEntry: null,
          phraseDetails: null,
          isLoading: false,
          isDictionaryResult: false,
        }));
      }
    } catch {
      setWordPanel((prev) => ({ ...prev, isLoading: false, error: 'Re-translate failed' }));
    }
  }, [wordPanel.word, wordPanel.sentence]);

  const handleSaveText = useCallback(async (newContent: string) => {
    await updateLesson(lessonId, { textContent: newContent });
    setLesson((prev) => (prev ? { ...prev, textContent: newContent } : prev));
    setReaderRefreshTrigger((prev) => prev + 1);
  }, [lessonId]);

  const handleEditingChange = useCallback((editing: boolean) => {
    if (editing) {
      setWordPanel((prev) => ({ ...prev, isOpen: false }));
    }
  }, []);

  // Navigate to prev/next lesson in collection
  const currentIndex = siblings.findIndex(l => l.id === lessonId);
  const prevLesson = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const nextLesson = currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

  // Handle keyboard shortcuts when the drawer is open
  useEffect(() => {
    if (!wordPanel.isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
          onSaveText={handleSaveText}
          onEditingChange={handleEditingChange}
          refreshTrigger={readerRefreshTrigger}
          prevLesson={prevLesson}
          nextLesson={nextLesson}
        />
      </div>

      {/* Translation drawer — slides in from the right */}
      <TranslationDrawer
        isOpen={wordPanel.isOpen}
        word={wordPanel.word}
        sentence={wordPanel.sentence}
        entry={wordPanel.dictEntry}
        aiTranslation={wordPanel.translation}
        aiPartOfSpeech={wordPanel.partOfSpeech}
        aiContextTranslation={wordPanel.aiContextTranslation}
        aiContextPartOfSpeech={wordPanel.aiContextPartOfSpeech}
        aiPhraseDetails={wordPanel.phraseDetails}
        isDictionaryResult={wordPanel.isDictionaryResult}
        isLoading={wordPanel.isLoading}
        isContextLoading={wordPanel.isContextLoading}
        error={wordPanel.error}
        existingEntry={wordPanel.existingEntry}
        onClose={closeWordPanel}
        onSpeak={(text) => speak(text.split(/\s+/).slice(0, 15).join(' '))}
        onSetLevel={setWordLevel}
        onMarkKnown={markAsKnown}
        onIgnore={ignoreWord}
        onRequestContextTranslation={requestContextTranslation}
        onRetranslate={retranslateWithAi}
      />

    </div>
  );
}
