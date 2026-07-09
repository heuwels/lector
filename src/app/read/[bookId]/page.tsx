'use client';

import { useEffect, useState, useCallback, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import MarkdownReader from '@/components/MarkdownReader';
import TranslationDrawer from '@/components/TranslationDrawer';
import { Button } from '@/components/ui/button';
import {
  type Lesson,
  type LessonSummary,
  type VocabEntry,
  getEntitlements,
  getLesson,
  getLessonsForCollection,
  saveVocab,
  getVocabByText,
  updateVocabState,
  updateLesson,
  incrementDailyStat,
  markVocabPushedToAnki,
} from '@/lib/data-layer';
import { showPlanLimitToast } from '@/lib/plan-limits';
import { addWordCard, addClozeCard } from '@/lib/anki';
import { translateWord, translatePhrase, streamWordGloss, enrichWord } from '@/lib/claude';
import {
  lookupWordRemote,
  cacheAcceptedTranslation,
  type ExpandedDictionaryEntry,
} from '@/lib/dictionary-client';
import { speak } from '@/lib/tts';
import { foldWord } from '@/lib/languages';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { WordPanelState } from '../types';
import { useActiveLanguage } from '@/utils/hooks';

export default function ReadPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId: lessonId } = use(params);
  const router = useRouter();
  const activeLang = useActiveLanguage();

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
    aiStructured: null,
    phraseDetails: null,
    isLoading: false,
    isContextLoading: false,
    isStreamingGloss: false,
    isEnriching: false,
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

    // Reflect the plan's phrase-selection cap before calling the API (#222).
    // The server enforces it regardless; this just turns the over-cap case
    // into an immediate upsell prompt instead of a doomed request.
    if (isPhrase) {
      const phraseWords = word.trim().split(/\s+/).filter(Boolean).length;
      const ent = await getEntitlements();
      const cap = ent?.limits?.phraseSelectionWords;
      if (ent && typeof cap === 'number' && phraseWords > cap) {
        showPlanLimitToast({
          error: 'plan_limit',
          metric: 'phraseSelectionWords',
          limit: cap,
          used: 0,
          requested: phraseWords,
          plan: ent.plan,
          upgrade: ent.plan === 'cloud' ? 'plus' : null,
        });
        return;
      }
    }

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
      aiStructured: null,
      phraseDetails: null,
      isLoading: true,
      isContextLoading: false,
      isStreamingGloss: false,
      isEnriching: false,
      isDictionaryResult: false,
      error: null,
      existingEntry: null,
    });

    incrementDailyStat('dictionaryLookups');

    const lookupPromise = getVocabByText(foldWord(word, activeLang));
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

    if (isPhrase) {
      if (!hasTranslation) {
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
      }
    } else {
      // For single words we ALWAYS run the dict lookup, even if vocab already
      // has a personal translation cached. Reasons:
      //   - the user expects to see senses/IPA/etymology, not just their
      //     saved gloss string
      //   - the cache (issue #100) only takes effect if we re-fetch — a
      //     previously-accepted AI translation must surface as `learned` now
      let dictEntry: ExpandedDictionaryEntry | null = null;
      try {
        dictEntry = await lookupWordRemote(word);
      } catch {
        dictEntry = null;
      }
      if (requestId !== translationRequestId.current) return;

      if (dictEntry && dictEntry.senses.length > 0) {
        const translation = dictEntry.senses.map((s) => s.gloss).join('; ');
        setWordPanel((prev) => ({
          ...prev,
          translation,
          partOfSpeech: dictEntry!.senses[0]?.partOfSpeech || null,
          dictEntry,
          isLoading: false,
          isDictionaryResult: true,
        }));
      } else if (!hasTranslation) {
        // No dict hit AND no saved vocab translation — stream a fast AI gloss.
        // The rich entry (senses/IPA/etymology) is opt-in via the Enrich button,
        // so this first paint is just a concise meaning, arriving token-by-token.
        try {
          const gloss = await streamWordGloss(word, sentence, (cumulative) => {
            if (requestId !== translationRequestId.current) return;
            setWordPanel((prev) => ({
              ...prev,
              translation: cumulative,
              partOfSpeech: null,
              dictEntry: null,
              aiStructured: null,
              isLoading: false,
              isStreamingGloss: true,
              isDictionaryResult: false,
            }));
          });
          if (requestId !== translationRequestId.current) return;
          setWordPanel((prev) => ({
            ...prev,
            translation: gloss,
            isLoading: false,
            isStreamingGloss: false,
          }));
        } catch (err) {
          if (requestId !== translationRequestId.current) return;
          console.error('Gloss stream error:', err);
          setWordPanel((prev) => ({
            ...prev,
            isLoading: false,
            isStreamingGloss: false,
            error: 'Failed to translate word. Check AI provider in settings.',
          }));
        }
      } else {
        // No dict hit but vocab has a saved translation — show that, mark
        // not-loading. No source pill (it's the user's own translation).
        setWordPanel((prev) => ({ ...prev, isLoading: false }));
      }
    }
  }, []);

  const closeWordPanel = useCallback(() => {
    setWordPanel((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Nested lookup from inside the drawer (issue #106) — e.g. clicking "vrug"
  // in the gloss "plural of vrug". Re-targets the drawer like a reader word
  // click, keeping the sentence the user was reading so a save/known action
  // on the underlying word records where it was encountered.
  const handleNestedLookup = useCallback(
    (nestedWord: string) => {
      void handleWordClick(nestedWord, wordPanel.sentence);
    },
    [handleWordClick, wordPanel.sentence],
  );

  const requestContextTranslation = useCallback(async () => {
    setWordPanel((prev) => ({ ...prev, isContextLoading: true }));
    try {
      const result = await translateWord(wordPanel.word, wordPanel.sentence);
      const structured =
        result.senses && result.senses.length > 0
          ? {
              senses: result.senses,
              ipa: result.ipa,
              etymology: result.etymology,
              relatedForms: result.relatedForms,
            }
          : null;
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
          aiStructured: structured ?? prev.aiStructured,
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

  // Enrich — upgrade the fast streamed gloss to the full dictionary entry
  // (senses / IPA / etymology / related forms). Off the critical path: the user
  // already has a meaning on screen; this just fills in the rich detail and, on
  // accept, gives the cache a proper multi-sense entry instead of a bare gloss.
  const enrichTranslation = useCallback(async () => {
    const requestId = translationRequestId.current;
    setWordPanel((prev) => ({ ...prev, isEnriching: true }));
    try {
      const result = await enrichWord(wordPanel.word, wordPanel.sentence);
      if (requestId !== translationRequestId.current) return;
      const structured =
        result.senses && result.senses.length > 0
          ? {
              senses: result.senses,
              ipa: result.ipa,
              etymology: result.etymology,
              relatedForms: result.relatedForms,
            }
          : null;
      setWordPanel((prev) => ({
        ...prev,
        translation: result.translation || prev.translation,
        partOfSpeech: result.partOfSpeech || prev.partOfSpeech,
        aiStructured: structured ?? prev.aiStructured,
        isEnriching: false,
      }));
    } catch (err) {
      if (requestId !== translationRequestId.current) return;
      console.error('Enrich error:', err);
      // Keep the gloss on screen; just stop the spinner (non-blocking failure).
      setWordPanel((prev) => ({ ...prev, isEnriching: false }));
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

  // Persist the current AI translation into the on-device dictionary cache.
  // Called from accept actions (Save / Known / level). No-op for phrases,
  // dictionary hits (already canonical), and when the AI didn't return
  // structured senses. Fire-and-forget — never blocks the UI action.
  const persistAcceptedTranslation = useCallback(() => {
    if (wordPanel.word.includes(' ')) return;
    if (wordPanel.dictEntry) return;
    // Prefer the rich enriched entry; otherwise persist the streamed gloss as a
    // single minimal sense so an accepted fast-path word still becomes a
    // "learned" dictionary entry (Enrich beforehand upgrades it to the full one).
    const senses =
      wordPanel.aiStructured?.senses ??
      (wordPanel.translation
        ? [{ partOfSpeech: wordPanel.partOfSpeech || '', gloss: wordPanel.translation }]
        : null);
    if (!senses) return;
    void cacheAcceptedTranslation({
      word: wordPanel.word,
      senses,
      ipa: wordPanel.aiStructured?.ipa,
      etymology: wordPanel.aiStructured?.etymology,
      relatedForms: wordPanel.aiStructured?.relatedForms,
      sourceSentence: wordPanel.sentence,
    });
  }, [
    wordPanel.word,
    wordPanel.sentence,
    wordPanel.dictEntry,
    wordPanel.aiStructured,
    wordPanel.translation,
    wordPanel.partOfSpeech,
  ]);

  const saveWordToVocab = useCallback(async () => {
    if (!wordPanel.translation) return;

    const existing = await resolveExistingEntry();
    const isPhrase = wordPanel.word.includes(' ');
    const entry: VocabEntry = {
      id: existing?.id || uuidv4(),
      text: foldWord(wordPanel.word, activeLang),
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

    // A failed save must not paint the word as saved (#232).
    if (!(await saveVocab(entry))) {
      toast.error('Could not save the word — check your connection and try again.');
      return;
    }
    await incrementDailyStat('newWordsSaved');
    persistAcceptedTranslation();

    setWordPanel((prev) => ({
      ...prev,
      existingEntry: entry,
    }));
    setReaderRefreshTrigger((prev) => prev + 1);
  }, [wordPanel, lessonId, resolveExistingEntry, persistAcceptedTranslation]);

  const markAsKnown = useCallback(async () => {
    const existing = await resolveExistingEntry();

    if (!existing) {
      const entry: VocabEntry = {
        id: uuidv4(),
        text: foldWord(wordPanel.word, activeLang),
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
      if (!(await saveVocab(entry))) {
        toast.error('Could not mark the word as known — check your connection.');
        return;
      }
    } else {
      if (!(await updateVocabState(existing.id, 'known'))) {
        toast.error('Could not mark the word as known — check your connection.');
        return;
      }
    }

    await incrementDailyStat('wordsMarkedKnown');
    persistAcceptedTranslation();
    setReaderRefreshTrigger((prev) => prev + 1);
    closeWordPanel();
  }, [wordPanel, lessonId, closeWordPanel, resolveExistingEntry, persistAcceptedTranslation]);

  const ignoreWord = useCallback(async () => {
    const existing = await resolveExistingEntry();

    if (!existing) {
      const entry: VocabEntry = {
        id: uuidv4(),
        text: foldWord(wordPanel.word, activeLang),
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
      if (!(await saveVocab(entry))) {
        toast.error('Could not ignore the word — check your connection.');
        return;
      }
    } else {
      if (!(await updateVocabState(existing.id, 'ignored'))) {
        toast.error('Could not ignore the word — check your connection.');
        return;
      }
    }

    setReaderRefreshTrigger((prev) => prev + 1);
    closeWordPanel();
  }, [wordPanel, lessonId, closeWordPanel, resolveExistingEntry]);

  const setWordLevel = useCallback(
    async (level: 1 | 2 | 3 | 4) => {
      if (!wordPanel.translation) return;

      const state = `level${level}` as 'level1' | 'level2' | 'level3' | 'level4';
      const existing = await resolveExistingEntry();

      if (!existing) {
        const entry: VocabEntry = {
          id: uuidv4(),
          text: foldWord(wordPanel.word, activeLang),
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
        if (!(await saveVocab(entry))) {
          toast.error('Could not set the word level — check your connection.');
          return;
        }
        await incrementDailyStat('newWordsSaved');
        setWordPanel((prev) => ({ ...prev, existingEntry: entry }));
      } else {
        if (!(await updateVocabState(existing.id, state))) {
          toast.error('Could not set the word level — check your connection.');
          return;
        }
        setWordPanel((prev) => ({
          ...prev,
          existingEntry: prev.existingEntry
            ? { ...prev.existingEntry, state }
            : { ...existing, state },
        }));
      }

      persistAcceptedTranslation();
      setReaderRefreshTrigger((prev) => prev + 1);
    },
    [wordPanel, lessonId, resolveExistingEntry, persistAcceptedTranslation],
  );

  const handleClose = useCallback(() => {
    if (lesson?.collectionId) {
      router.push(`/collection/${lesson.collectionId}`);
    } else {
      router.push('/');
    }
  }, [router, lesson]);

  // Read Anki deck names from localStorage — same keys the Settings page writes.
  const getAnkiDecks = useCallback(() => {
    const basic = localStorage.getItem('lector-anki-deck') || activeLang.native;
    const cloze = localStorage.getItem('lector-anki-cloze-deck') || `${activeLang.native}::Cloze`;
    return { basic, cloze };
  }, [activeLang.native]);

  // Ensure a vocab entry exists for the current word and return it.
  // Creates a level1 entry if none exists, so the word appears in the vocab list.
  const ensureVocabEntry = useCallback(async (): Promise<VocabEntry> => {
    const existing = await resolveExistingEntry();
    if (existing) return existing;

    const isPhrase = wordPanel.word.includes(' ');
    const entry: VocabEntry = {
      id: uuidv4(),
      text: foldWord(wordPanel.word, activeLang),
      type: isPhrase ? 'phrase' : 'word',
      sentence: wordPanel.sentence,
      translation: wordPanel.translation || '',
      state: 'level1',
      stateUpdatedAt: new Date(),
      reviewCount: 0,
      bookId: lessonId,
      createdAt: new Date(),
      pushedToAnki: false,
    };
    await saveVocab(entry);
    await incrementDailyStat('newWordsSaved');
    persistAcceptedTranslation();
    setWordPanel((prev) => ({ ...prev, existingEntry: entry }));
    setReaderRefreshTrigger((prev) => prev + 1);
    return entry;
  }, [wordPanel, lessonId, resolveExistingEntry, persistAcceptedTranslation]);

  const addWordToAnki = useCallback(async () => {
    const { basic: deckName } = getAnkiDecks();
    const wordMeaning =
      wordPanel.dictEntry?.senses[0]?.gloss ??
      wordPanel.aiStructured?.senses[0]?.gloss ??
      wordPanel.translation ??
      '';
    const translation = wordPanel.aiContextTranslation ?? wordPanel.translation ?? '';

    const entry = await ensureVocabEntry();
    const noteId = await addWordCard(deckName, wordPanel.word, translation, wordMeaning);
    await markVocabPushedToAnki(entry.id, noteId);
    setWordPanel((prev) => ({
      ...prev,
      existingEntry: prev.existingEntry
        ? { ...prev.existingEntry, pushedToAnki: true, ankiNoteId: noteId }
        : { ...entry, pushedToAnki: true, ankiNoteId: noteId },
    }));
  }, [wordPanel, getAnkiDecks, ensureVocabEntry]);

  const addClozeToAnki = useCallback(
    async (blankWord: string) => {
      const { cloze: clozeDeck } = getAnkiDecks();
      const translation = wordPanel.aiContextTranslation ?? wordPanel.translation ?? '';

      const entry = await ensureVocabEntry();
      const noteId = await addClozeCard(
        clozeDeck,
        wordPanel.word,
        blankWord,
        translation,
        translation,
      );
      await markVocabPushedToAnki(entry.id, noteId);
      setWordPanel((prev) => ({
        ...prev,
        existingEntry: prev.existingEntry
          ? { ...prev.existingEntry, pushedToAnki: true, ankiNoteId: noteId }
          : { ...entry, pushedToAnki: true, ankiNoteId: noteId },
      }));
    },
    [wordPanel, getAnkiDecks, ensureVocabEntry],
  );

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
        const structured =
          result.senses && result.senses.length > 0
            ? {
                senses: result.senses,
                ipa: result.ipa,
                etymology: result.etymology,
                relatedForms: result.relatedForms,
              }
            : null;
        setWordPanel((prev) => ({
          ...prev,
          translation: result.translation,
          partOfSpeech: result.partOfSpeech || null,
          dictEntry: null,
          aiStructured: structured,
          phraseDetails: null,
          isLoading: false,
          isDictionaryResult: false,
        }));
      }
    } catch {
      setWordPanel((prev) => ({ ...prev, isLoading: false, error: 'Re-translate failed' }));
    }
  }, [wordPanel.word, wordPanel.sentence]);

  const handleSaveText = useCallback(
    async (newContent: string) => {
      await updateLesson(lessonId, { textContent: newContent });
      setLesson((prev) => (prev ? { ...prev, textContent: newContent } : prev));
      setReaderRefreshTrigger((prev) => prev + 1);
    },
    [lessonId],
  );

  const handleEditingChange = useCallback((editing: boolean) => {
    if (editing) {
      setWordPanel((prev) => ({ ...prev, isOpen: false }));
    }
  }, []);

  // Navigate to prev/next lesson in collection
  const currentIndex = siblings.findIndex((l) => l.id === lessonId);
  const prevLesson = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const nextLesson = currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

  // Handle keyboard shortcuts when the drawer is open
  useEffect(() => {
    if (!wordPanel.isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+C copies the word or phrase the drawer is showing. Word spans
      // keep the whitespace between them in the DOM, so this — like a native
      // copy — preserves spaces (readers that drop inter-word gaps copy e.g.
      // "diegroothond"). If the user has made a real text selection, defer to
      // the browser so an ordinary copy still works.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'c') {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.toString().trim()) return;
        if (!wordPanel.word) return;
        e.preventDefault();
        void navigator.clipboard?.writeText(wordPanel.word).then(
          () => toast.success('Copied', { duration: 1200 }),
          () => {},
        );
        return;
      }
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
  }, [
    wordPanel.isOpen,
    wordPanel.word,
    wordPanel.existingEntry,
    wordPanel.translation,
    closeWordPanel,
    markAsKnown,
    ignoreWord,
    saveWordToVocab,
    setWordLevel,
  ]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-card">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-3 border-primary border-t-transparent" />
          <p className="text-muted-foreground">Loading lesson...</p>
        </div>
      </div>
    );
  }

  if (error || !lesson) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-card p-8">
        <div className="mb-4 text-xl text-destructive">
          {error || 'Lesson not found'}
        </div>
        <Button variant="secondary" onClick={() => router.push('/')}>
          Go to Library
        </Button>
      </div>
    );
  }

  // What the drawer renders as the rich entry: a real dictionary hit if we have
  // one, otherwise the AI's enriched structured result mapped into the same
  // shape. Kept separate from wordPanel.dictEntry (which stays null for AI) so
  // the save handlers still treat an AI result as cacheable, not a dict hit.
  const displayEntry: ExpandedDictionaryEntry | null =
    wordPanel.dictEntry ??
    (wordPanel.aiStructured
      ? {
          word: wordPanel.word,
          senses: wordPanel.aiStructured.senses,
          ipa: wordPanel.aiStructured.ipa,
          etymology: wordPanel.aiStructured.etymology,
          relatedForms: wordPanel.aiStructured.relatedForms,
        }
      : null);

  // Offer Enrich only for a bare single-word gloss that isn't already rich.
  const canEnrich =
    !wordPanel.word.includes(' ') &&
    !wordPanel.dictEntry &&
    !wordPanel.aiStructured &&
    !!wordPanel.translation &&
    !wordPanel.isLoading &&
    !wordPanel.isStreamingGloss;

  return (
    <div className="flex h-dvh flex-col overflow-x-hidden bg-card print:block print:h-auto print:overflow-visible">
      <div className="relative flex-1 overflow-hidden print:block print:h-auto print:overflow-visible">
        <MarkdownReader
          lesson={lesson}
          onWordClick={handleWordClick}
          wordPanelOpen={wordPanel.isOpen}
          onClose={handleClose}
          onSaveText={handleSaveText}
          onEditingChange={handleEditingChange}
          refreshTrigger={readerRefreshTrigger}
          prevLesson={prevLesson}
          nextLesson={nextLesson}
        />
      </div>
      <TranslationDrawer
        isOpen={wordPanel.isOpen}
        word={wordPanel.word}
        sentence={wordPanel.sentence}
        // WordPanelState field names differ from TranslationDrawerProps; map them
        // explicitly. A spread silently dropped these (all props optional, so tsc
        // stayed green) and the drawer rendered "No definition found" for every word.
        entry={displayEntry}
        aiTranslation={wordPanel.translation}
        aiPartOfSpeech={wordPanel.partOfSpeech}
        aiContextTranslation={wordPanel.aiContextTranslation}
        aiContextPartOfSpeech={wordPanel.aiContextPartOfSpeech}
        aiPhraseDetails={wordPanel.phraseDetails}
        isDictionaryResult={wordPanel.isDictionaryResult}
        isLoading={wordPanel.isLoading}
        isContextLoading={wordPanel.isContextLoading}
        isStreaming={wordPanel.isStreamingGloss}
        isEnriching={wordPanel.isEnriching}
        error={wordPanel.error}
        existingEntry={wordPanel.existingEntry}
        onClose={closeWordPanel}
        onSpeak={(text) => speak(text.split(/\s+/).slice(0, 15).join(' '))}
        onSetLevel={setWordLevel}
        onMarkKnown={markAsKnown}
        onIgnore={ignoreWord}
        onRequestContextTranslation={requestContextTranslation}
        onEnrich={canEnrich ? enrichTranslation : undefined}
        onRetranslate={retranslateWithAi}
        onLookupWord={handleNestedLookup}
        onAddToAnki={!wordPanel.word.includes(' ') ? addWordToAnki : undefined}
        onAddCloze={wordPanel.word.includes(' ') ? addClozeToAnki : undefined}
      />
    </div>
  );
}
