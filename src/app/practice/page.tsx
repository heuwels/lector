'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle, Star } from 'lucide-react';
import TranslationDrawer from '@/components/TranslationDrawer';
import {
  ClozeSentence,
  ClozeMasteryLevel,
  ClozeCollection,
  getClozeSentencesByCollection,
  getNewSentencesByCollection,
  getCollectionCounts,
  updateClozeAfterReview,
  getTodayStats,
  incrementDailyStat,
  migrateClozeSentences,
  seedSentenceBank,
  updateWordState,
} from '@/lib/data-layer';
import { speak } from '@/lib/tts';
import { playCorrectSound, playIncorrectSound } from '@/lib/sounds';
import { translateWord } from '@/lib/claude';
import { lookupWordRemote, type ExpandedDictionaryEntry } from '@/lib/dictionary-client';
import { splitTrailingPunctuation } from '@/lib/words';
import {
  createBlankedSentence,
  calculateDictationPoints,
  calculateNextReview,
  calculatePoints,
  checkAnswer,
  diffDictation,
  generateDistractors,
  getFuzzyStatus,
  normalize,
  scoreDictation,
  shuffle,
} from './utils';
import type {
  CurrentSentence,
  DictationResult,
  IFeedbackData,
  PracticeFormat,
  PracticeMode,
  PracticeState,
  RoundSize,
  RoundType,
} from './types';
import {
  COLLECTION_LABELS,
  PRACTICE_FORMAT_SETTING_KEY,
  ROUND_SIZES,
  VISIBLE_COLLECTIONS,
} from './constants';
import BlacklistSentence from './components/BlacklistSentence';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { SETTINGS_KEYS } from '@/app/settings/constants';
import EmptyState from './components/EmptyState';
import PageHeader from '@/components/PageHeader';
import Feedback from './components/Feedback';
import DictationCard from './components/Dictation/DictationCard';
import DictationFeedback from './components/Dictation/DictationFeedback';

export default function PracticePage() {
  // State
  const [state, setState] = useState<PracticeState>('setup');
  const [queue, setQueue] = useState<ClozeSentence[]>([]);
  const [current, setCurrent] = useState<CurrentSentence | null>(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [originalRoundSize, setOriginalRoundSize] = useState<number>(20);
  const [roundSize, setRoundSize] = useState<number>(20);
  const [roundProgress, setRoundProgress] = useState(0);
  const [roundCorrect, setRoundCorrect] = useState(0);
  const [points, setPoints] = useState(0);
  const [seeded, setSeeded] = useState(false);

  // Translation visibility. Initialised from the "Hide translation by default"
  // setting on mount; Alt+T toggles it live during a round.
  const [showTranslation, setShowTranslation] = useState(true);

  // Practice format (cloze vs dictation) and, within cloze, the answer mode
  const [practiceFormat, setPracticeFormat] = useState<PracticeFormat>('cloze');
  const [practiceMode, setPracticeMode] = useState<PracticeMode>('type');
  const [roundType, setRoundType] = useState<RoundType>('new');

  // Dictation result (the graded diff), shown on the feedback screen
  const [dictationResult, setDictationResult] = useState<DictationResult | null>(null);

  // Multiple choice state
  const [mcOptions, setMcOptions] = useState<string[]>([]);
  const [mcSelected, setMcSelected] = useState<number | null>(null);
  const [mcCorrectIdx, setMcCorrectIdx] = useState<number>(0);
  const [mcLocked, setMcLocked] = useState(false);
  const [mcFallback, setMcFallback] = useState(false); // Temporary MC switch from type mode

  // Collection state
  const [selectedCollection, setSelectedCollection] = useState<ClozeCollection>('top500');
  const [collectionCounts, setCollectionCounts] = useState<Record<
    ClozeCollection,
    { total: number; due: number; mastered: number }
  > | null>(null);

  // Feedback state
  const [feedbackData, setFeedbackData] = useState<IFeedbackData | null>(null);
  const [hintLetters, setHintLetters] = useState(0);
  const [retryQueue, setRetryQueue] = useState<ClozeSentence[]>([]);
  const [isRetryPhase, setIsRetryPhase] = useState(false);

  // Word definition tooltip state
  const [wordTooltip, setWordTooltip] = useState<{
    word: string;
    translation: string | null;
    partOfSpeech: string | null;
    dictEntry: ExpandedDictionaryEntry | null;
    isLoading: boolean;
    isContextLoading: boolean;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  // Pending MC feedback timer — must be cancelled on navigation/unmount so a
  // stale closure can't record a review for a screen the user already left.
  const mcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMcTimer = useCallback(() => {
    if (mcTimerRef.current !== null) {
      clearTimeout(mcTimerRef.current);
      mcTimerRef.current = null;
    }
  }, []);

  // Cancel any pending MC timer on unmount
  useEffect(() => clearMcTimer, [clearMcTimer]);

  // Load collection counts and seed on mount
  useEffect(() => {
    const init = async () => {
      const stats = await getTodayStats();
      setPoints(stats.points);

      // Load saved practice mode
      const savedMode = localStorage.getItem('cloze-practice-mode');
      if (savedMode === 'mc' || savedMode === 'type') {
        setPracticeMode(savedMode);
      }

      // Load saved practice format (cloze vs dictation)
      const savedFormat = localStorage.getItem(PRACTICE_FORMAT_SETTING_KEY);
      if (savedFormat === 'cloze' || savedFormat === 'dictation') {
        setPracticeFormat(savedFormat);
      }

      // Respect the "hide translation by default" setting (Alt+T toggles live)
      setShowTranslation(localStorage.getItem(SETTINGS_KEYS.HIDE_TRANSLATION) !== 'true');

      await migrateClozeSentences();
      await seedSentenceBank();
      setSeeded(true);

      const counts = await getCollectionCounts();
      setCollectionCounts(counts);
    };
    init();
  }, []);

  // Save practice mode to localStorage when it changes
  const handleSetPracticeMode = useCallback((mode: PracticeMode) => {
    setPracticeMode(mode);
    localStorage.setItem('cloze-practice-mode', mode);
  }, []);

  // Save practice format (cloze vs dictation) to localStorage when it changes
  const handleSetPracticeFormat = useCallback((format: PracticeFormat) => {
    setPracticeFormat(format);
    localStorage.setItem(PRACTICE_FORMAT_SETTING_KEY, format);
  }, []);

  // Handle word click for inline definitions
  const handleWordClick = useCallback(
    async (word: string) => {
      if (!current) return;
      const [cleanWord] = splitTrailingPunctuation(word);
      if (!cleanWord) return;

      setWordTooltip({
        word: cleanWord,
        translation: null,
        partOfSpeech: null,
        dictEntry: null,
        isLoading: true,
        isContextLoading: false,
      });

      // Try the on-device SQLite dictionary first
      let dictEntry: ExpandedDictionaryEntry | null = null;
      try {
        dictEntry = await lookupWordRemote(cleanWord);
      } catch {
        dictEntry = null;
      }

      if (dictEntry && dictEntry.senses.length > 0) {
        setWordTooltip({
          word: cleanWord,
          translation: dictEntry.senses.map((s) => s.gloss).join('; '),
          partOfSpeech: dictEntry.senses[0]?.partOfSpeech || null,
          dictEntry,
          isLoading: false,
          isContextLoading: false,
        });
        return;
      }

      try {
        const result = await translateWord(cleanWord, current.sentence.sentence);
        setWordTooltip({
          word: cleanWord,
          translation: result.translation,
          partOfSpeech: result.partOfSpeech || null,
          dictEntry: null,
          isLoading: false,
          isContextLoading: false,
        });
      } catch {
        setWordTooltip({
          word: cleanWord,
          translation: null,
          partOfSpeech: null,
          dictEntry: null,
          isLoading: false,
          isContextLoading: false,
        });
      }
    },
    [current],
  );

  // Ask the LLM to retranslate the active word using the full (un-blanked)
  // sentence as context. Replaces the on-device gloss with a richer in-context
  // translation. The blanked sentence is still shown in the drawer — the AI
  // sees the full one for context but never reveals the cloze answer to the UI.
  const requestContextTranslation = useCallback(async () => {
    if (!wordTooltip || !current) return;
    setWordTooltip((prev) => (prev ? { ...prev, isContextLoading: true } : prev));
    try {
      const result = await translateWord(wordTooltip.word, current.sentence.sentence);
      setWordTooltip((prev) =>
        prev
          ? {
              ...prev,
              translation: result.translation,
              partOfSpeech: result.partOfSpeech || prev.partOfSpeech,
              dictEntry: null,
              isContextLoading: false,
            }
          : prev,
      );
    } catch {
      setWordTooltip((prev) => (prev ? { ...prev, isContextLoading: false } : prev));
    }
  }, [wordTooltip, current]);

  // Generate MC options when current sentence or queue changes
  const generateMcOptionsForSentence = useCallback(
    (sentence: ClozeSentence, sentenceQueue: ClozeSentence[]) => {
      const distractors = generateDistractors(sentence.clozeWord, sentenceQueue);
      // Pad with fallback words if not enough distractors
      const fallbacks = ['die', 'het', 'van', 'wat', 'nie', 'kan', 'sal', 'met'];
      while (distractors.length < 3) {
        const fb = fallbacks.find(
          (w) =>
            normalize(w) !== normalize(sentence.clozeWord) &&
            !distractors.some((d) => normalize(d) === normalize(w)),
        );
        if (fb) distractors.push(fb);
        else break;
      }
      // Strip trailing punctuation from all options so punctuation doesn't give away the answer
      const cleanCorrect = splitTrailingPunctuation(sentence.clozeWord)[0];
      const cleanDistractors = distractors.slice(0, 3).map((d) => splitTrailingPunctuation(d)[0]);
      const options = shuffle([cleanCorrect, ...cleanDistractors]);
      const correctIdx = options.findIndex((o) => normalize(o) === normalize(cleanCorrect));
      setMcOptions(options);
      setMcCorrectIdx(correctIdx);
      setMcSelected(null);
      setMcLocked(false);
    },
    [],
  );

  // Load next sentence from queue
  const loadNextSentence = useCallback(
    (sentenceQueue: ClozeSentence[]) => {
      clearMcTimer();
      if (sentenceQueue.length === 0) {
        setState('complete');
        return;
      }

      const nextSentence = sentenceQueue[0];
      const blankedSentence = createBlankedSentence(nextSentence.sentence, nextSentence.clozeIndex);

      setCurrent({ sentence: nextSentence, blankedSentence });
      setUserAnswer('');
      setFeedbackData(null);
      setDictationResult(null);
      setHintLetters(0);
      setMcFallback(false);
      setWordTooltip(null);
      submittingRef.current = false;
      setState('practicing');

      // Cloze-only setup. Dictation renders its own card, which manages audio
      // autoplay and input focus itself, so skip MC generation and the input
      // focus here when dictating.
      if (practiceFormat === 'cloze') {
        // Generate MC options if in MC mode
        if (practiceMode === 'mc') {
          generateMcOptionsForSentence(nextSentence, sentenceQueue);
        }

        // Focus input after state update (only in type mode)
        if (practiceMode === 'type') {
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      }
    },
    [practiceFormat, practiceMode, generateMcOptionsForSentence, clearMcTimer],
  );

  // Start a round with explicit params (used by review buttons)
  const startRoundWith = useCallback(
    async (collection: ClozeCollection, type: RoundType, size: number) => {
      setState('loading');
      setSelectedCollection(collection);
      setRoundType(type);
      setOriginalRoundSize(size as RoundSize);
      setRoundSize(size as RoundSize);
      setRoundProgress(0);
      setRoundCorrect(0);
      setRetryQueue([]);
      setIsRetryPhase(false);

      try {
        let sentences: ClozeSentence[];

        if (type === 'review') {
          sentences = await getClozeSentencesByCollection(collection, size, []);
        } else {
          sentences = await getNewSentencesByCollection(collection, size, []);
        }

        // Shuffle
        for (let i = sentences.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [sentences[i], sentences[j]] = [sentences[j], sentences[i]];
        }

        if (sentences.length > 0) {
          setQueue(sentences);
          loadNextSentence(sentences);
        } else {
          setState('empty');
        }
      } catch (error) {
        console.error('Failed to start round:', error);
        setState('complete');
      }
    },
    [loadNextSentence],
  );

  // Start a round using current state values
  const startRound = useCallback(() => {
    startRoundWith(selectedCollection, roundType, originalRoundSize);
  }, [selectedCollection, roundType, roundSize, startRoundWith, originalRoundSize]);

  // Handle hint - reveal next letter
  const handleHint = useCallback(() => {
    if (!current) return;
    const correctWord = normalize(current.sentence.clozeWord);
    const currentInput = normalize(userAnswer);

    // Find how many leading characters are already correct
    let correctPrefix = 0;
    for (let i = 0; i < currentInput.length && i < correctWord.length; i++) {
      if (currentInput[i] === correctWord[i]) {
        correctPrefix++;
      } else {
        break;
      }
    }

    // Reveal one more letter beyond the correct prefix
    const revealCount = Math.min(Math.max(correctPrefix + 1, hintLetters + 1), correctWord.length);
    setHintLetters(hintLetters + 1);
    setUserAnswer(correctWord.slice(0, revealCount));
    inputRef.current?.focus();
  }, [current, hintLetters, userAnswer]);

  // Persist a graded answer to the shared SRS card and update round/points
  // state. Format-agnostic: cloze and dictation both decide correctness and
  // points their own way, then hand the result here. The card, mastery levels
  // and retry queue are identical across formats (same clozeSentences row).
  const commitReview = useCallback(
    async (isCorrect: boolean, earnedPoints: number, newMastery: ClozeMasteryLevel) => {
      if (!current) return;
      const nextReview = calculateNextReview(newMastery);

      // Update database
      await updateClozeAfterReview(current.sentence.id, isCorrect, newMastery, nextReview);
      if (newMastery === 100) {
        // Strip trailing punctuation so the reader's known-word lookup (clean,
        // lowercased tokens) matches and fluency stats don't double-count.
        await updateWordState(splitTrailingPunctuation(current.sentence.clozeWord)[0], 'known');
      }
      await incrementDailyStat('clozePracticed');
      if (earnedPoints > 0) {
        await incrementDailyStat('points', earnedPoints);
      }

      // Update local state — only count first-pass answers toward round progress,
      // so retried sentences don't push the counter past roundSize (issue #57).
      if (!isRetryPhase) {
        setRoundProgress((prev) => prev + 1);
        if (isCorrect) setRoundCorrect((prev) => prev + 1);
      }
      if (earnedPoints > 0) {
        setPoints((prev) => prev + earnedPoints);
      }

      if (!isCorrect) {
        // Add to retry queue so incorrect answers are re-tested. The card was
        // just demoted to mastery 0 in the DB — the queued copy must carry that,
        // or the retry would promote it straight back from its old level.
        setRetryQueue((prev) => [
          ...prev,
          { ...current.sentence, masteryLevel: 0 as ClozeMasteryLevel },
        ]);
      }
    },
    [current, isRetryPhase],
  );

  // Record a completed cloze answer: decide the mastery and points, then show
  // feedback. Shared by typed answers and multiple choice — the only
  // differences are how correctness is decided (the caller's job, before the
  // pause/sound) and the points base (8 for typing, 4 for MC), passed via `mode`.
  const recordAnswer = useCallback(
    async (isCorrect: boolean, submittedAnswer: string, mode: PracticeMode) => {
      if (!current) return;

      const previousMastery = current.sentence.masteryLevel;
      const newMastery: ClozeMasteryLevel = isCorrect
        ? (Math.min(previousMastery + 25, 100) as ClozeMasteryLevel)
        : 0;

      // No points in the retry phase — the answer was revealed when the card
      // was first missed this round. Points scale with the mastery just reached.
      const earnedPoints =
        isCorrect && !isRetryPhase
          ? calculatePoints(
              newMastery,
              hintLetters,
              normalize(current.sentence.clozeWord).length,
              mode,
            )
          : 0;

      await commitReview(isCorrect, earnedPoints, newMastery);

      setFeedbackData({
        isCorrect,
        correctWord: splitTrailingPunctuation(current.sentence.clozeWord)[0],
        userAnswer: submittedAnswer,
        translation: current.sentence.translation,
        points: earnedPoints,
        newMastery,
        previousMastery,
      });

      setState('feedback');

      if (isCorrect) {
        speak(current.sentence.sentence);
      }
    },
    [current, hintLetters, isRetryPhase, commitReview],
  );

  // Record a completed dictation answer: word-level diff against the spoken
  // sentence drives the score. A pass (≥ threshold of the words) advances the
  // SRS card; anything less resets it, matching cloze's miss behaviour. Points
  // scale with both the mastery reached and the transcription accuracy.
  //
  // Surrender reveals the answer without finishing it: it's always a miss (the
  // card resets and re-queues, like a wrong cloze answer), regardless of what
  // was typed so far — so it can never accidentally award a pass.
  const recordDictation = useCallback(
    async (typed: string, surrendered = false) => {
      if (!current) return;

      const diff = diffDictation(typed, current.sentence.sentence);
      const score = scoreDictation(diff);
      const isPass = surrendered ? false : score.isPass;
      const isPerfect = surrendered ? false : score.isPerfect;

      if (isPass) {
        playCorrectSound();
      } else {
        playIncorrectSound();
      }

      const previousMastery = current.sentence.masteryLevel;
      const newMastery: ClozeMasteryLevel = isPass
        ? (Math.min(previousMastery + 25, 100) as ClozeMasteryLevel)
        : 0;
      const earnedPoints =
        isPass && !isRetryPhase ? calculateDictationPoints(newMastery, diff.accuracy) : 0;

      await commitReview(isPass, earnedPoints, newMastery);

      setDictationResult({
        diff,
        typedRaw: typed,
        isPass,
        isPerfect,
        surrendered,
        points: earnedPoints,
        newMastery,
        previousMastery,
      });

      setState('feedback');
    },
    [current, isRetryPhase, commitReview],
  );

  // Handle answer submission (type mode)
  const handleSubmit = async () => {
    if (!current || !userAnswer.trim() || submittingRef.current) return;
    submittingRef.current = true;

    const answer = userAnswer.trim();
    const isCorrect = checkAnswer(answer, current.sentence.clozeWord);
    if (isCorrect) {
      playCorrectSound();
    } else {
      playIncorrectSound();
    }
    await recordAnswer(isCorrect, answer, 'type');
  };

  // Handle MC option selection
  const handleMcSelect = useCallback(
    (index: number) => {
      if (mcLocked || !current) return;
      setMcSelected(index);
      setMcLocked(true);

      const selectedWord = mcOptions[index];
      const isCorrect = index === mcCorrectIdx;

      // Sound effects immediately on selection
      if (isCorrect) {
        playCorrectSound();
      } else {
        playIncorrectSound();
      }

      // Brief pause so the chosen option's right/wrong highlight stays visible
      // before the feedback panel replaces it — longer on a miss so the user can
      // see which option was correct. This delay (not extra work) is why MC feels
      // slower than typing, where feedback appears the instant you submit.
      const delay = isCorrect ? 600 : 1200;
      mcTimerRef.current = setTimeout(() => {
        mcTimerRef.current = null;
        recordAnswer(isCorrect, selectedWord, 'mc');
      }, delay);
    },
    [mcLocked, current, mcCorrectIdx, mcOptions, recordAnswer],
  );

  // Handle next sentence
  const handleNext = useCallback(async () => {
    const remainingQueue = queue.slice(1);
    setQueue(remainingQueue);

    if (remainingQueue.length > 0) {
      loadNextSentence(remainingQueue);
    } else if (retryQueue.length > 0) {
      const retryList = [...retryQueue];
      setRetryQueue([]);
      setQueue(retryList);
      setIsRetryPhase(true);
      loadNextSentence(retryList);
    } else {
      setState('complete');
    }
  }, [queue, retryQueue, loadNextSentence]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (state === 'feedback') {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.repeat) {
          e.preventDefault();
          handleNext();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    if (
      state === 'practicing' &&
      practiceFormat === 'cloze' &&
      practiceMode === 'mc' &&
      !mcLocked
    ) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        // Number keys 1-4 for MC selection
        if (e.key >= '1' && e.key <= '4') {
          const idx = parseInt(e.key) - 1;
          if (idx < mcOptions.length) {
            e.preventDefault();
            handleMcSelect(idx);
          }
        }
        // Space to trigger TTS in MC mode
        if (e.key === ' ') {
          e.preventDefault();
          if (current) speak(current.sentence.sentence);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    // Space to trigger TTS in type mode when input is not focused
    if (state === 'practicing' && practiceFormat === 'cloze' && practiceMode === 'type') {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === ' ' && document.activeElement !== inputRef.current) {
          e.preventDefault();
          if (current) speak(current.sentence.sentence);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [
    state,
    handleNext,
    practiceFormat,
    practiceMode,
    mcLocked,
    mcOptions,
    handleMcSelect,
    current,
  ]);

  // Alt+T toggles translation visibility (while practicing and on feedback)
  useEffect(() => {
    if (state !== 'practicing' && state !== 'feedback') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Match on e.code so it's keyboard-layout independent — on macOS Alt+T
      // (Option+T) would otherwise arrive as e.key === '†'.
      if (e.altKey && e.code === 'KeyT') {
        e.preventDefault();
        setShowTranslation((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state]);

  const handleBackPressed = async () => {
    setState('setup');
    const counts = await getCollectionCounts();
    setCollectionCounts(counts);
  };

  const handleNewRoundPressed = () => startRoundWith(selectedCollection, 'new', roundSize);

  const handleSentenceBlacklisted = useCallback(async () => {
    const remainingQueue = queue.slice(1);
    setQueue(remainingQueue);
    setRoundSize(roundSize - 1);

    if (remainingQueue.length > 0) {
      loadNextSentence(remainingQueue);
    } else if (retryQueue.length > 0) {
      const retryList = [...retryQueue];
      setRetryQueue([]);
      setQueue(retryList);
      setIsRetryPhase(true);
      loadNextSentence(retryList);
    } else {
      setState('complete');
    }
  }, [queue, retryQueue, roundSize, loadNextSentence]);

  const progressPercent = roundSize > 0 ? Math.min((roundProgress / roundSize) * 100, 100) : 0;

  return (
    <>
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Setup screen */}
        {state === 'setup' && (
          <div className="py-6">
            <PageHeader
              title={practiceFormat === 'dictation' ? 'Dictation Practice' : 'Cloze Practice'}
            ></PageHeader>

            {/* Practice format: Cloze (fill the blank) vs Dictation (hear the
                sentence, type it back). Both share the collection / round size /
                review options below. */}
            <div className="mb-6">
              <div className="grid grid-cols-2 gap-2">
                {/* Explicit aria-labels keep each button's accessible name to
                    just "Cloze"/"Dictation" — the descriptive subtitle stays
                    visible but doesn't leak into role-based locators (e.g. the
                    cloze "Type" mode button would otherwise also match the
                    "Type what you hear" subtitle). */}
                <Button
                  aria-label="Cloze"
                  onClick={() => handleSetPracticeFormat('cloze')}
                  variant={practiceFormat === 'cloze' ? 'default' : 'secondary'}
                  className="flex h-14 flex-col justify-center gap-0"
                >
                  <div>Cloze</div>
                  <div className="mt-0.5 text-[11px] font-normal opacity-75">Fill in the blank</div>
                </Button>
                <Button
                  aria-label="Dictation"
                  onClick={() => handleSetPracticeFormat('dictation')}
                  variant={practiceFormat === 'dictation' ? 'default' : 'secondary'}
                  className="flex h-14 flex-col justify-center gap-0"
                >
                  <div>Dictation</div>
                  <div className="mt-0.5 text-[11px] font-normal opacity-75">
                    Type what you hear
                  </div>
                </Button>
              </div>
            </div>

            {/* Review Due section */}
            {(() => {
              const totalDue = VISIBLE_COLLECTIONS.reduce(
                (sum, c) => sum + (collectionCounts?.[c]?.due || 0),
                0,
              );
              if (totalDue === 0) return null;
              return (
                <div className="mb-8 rounded-2xl border border-[var(--gold-lip)] bg-[var(--gold-soft)] p-5">
                  <h2 className="mb-3 text-base font-semibold text-[var(--gold-strong)]">
                    Review Due ({totalDue})
                  </h2>
                  <div className="space-y-2">
                    {VISIBLE_COLLECTIONS.map((coll) => {
                      const due = collectionCounts?.[coll]?.due || 0;
                      if (due === 0) return null;
                      return (
                        <button
                          key={coll}
                          onClick={() => {
                            setSelectedCollection(coll);
                            setRoundType('review');
                            setRoundSize(Math.min(due, 20) as RoundSize);
                            startRoundWith(coll, 'review', Math.min(due, 20));
                          }}
                          className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 transition-all hover:border-[var(--gold-strong)] active:scale-[0.98]"
                        >
                          <span className="font-medium text-foreground">
                            {COLLECTION_LABELS[coll]}
                          </span>
                          <span className="text-sm font-semibold text-[var(--gold-strong)]">
                            {due} due
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Learn New section */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-4 text-base font-semibold text-foreground">Learn New</h2>

              {/* Collection */}
              <div className="mb-4">
                <div className="grid grid-cols-3 gap-2">
                  {VISIBLE_COLLECTIONS.map((coll) => {
                    const count = collectionCounts?.[coll];
                    return (
                      <Button
                        key={coll}
                        onClick={() => setSelectedCollection(coll)}
                        variant={selectedCollection === coll ? 'default' : 'secondary'}
                        className="flex h-14 flex-col justify-center gap-0"
                      >
                        <div>{COLLECTION_LABELS[coll]}</div>
                        {count && count.total > 0 && (
                          <div className="mt-0.5 text-[11px] font-normal opacity-75">
                            {count.mastered}/{count.total} mastered
                          </div>
                        )}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Round size + Mode in a row */}
              <div className="mb-4 flex gap-4">
                <div className="flex-1">
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">
                    Sentences
                  </label>
                  <div className="flex gap-1.5">
                    {ROUND_SIZES.map((size) => (
                      <Button
                        key={size}
                        size="sm"
                        variant={roundSize === size ? 'default' : 'secondary'}
                        onClick={() => {
                          setOriginalRoundSize(size);
                          setRoundSize(size);
                        }}
                      >
                        {size}
                      </Button>
                    ))}
                  </div>
                </div>
                {/* Type/MC only applies to cloze — dictation is always
                    type-the-whole-sentence. */}
                {practiceFormat === 'cloze' && (
                  <div className="">
                    <label className="mb-2 block text-xs font-medium text-muted-foreground">
                      Mode
                    </label>
                    <div className="flex gap-1.5">
                      <Button
                        onClick={() => handleSetPracticeMode('type')}
                        variant={practiceMode === 'type' ? 'default' : 'secondary'}
                      >
                        Type
                      </Button>
                      <Button
                        onClick={() => handleSetPracticeMode('mc')}
                        variant={practiceMode === 'mc' ? 'default' : 'secondary'}
                      >
                        MC
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Start button */}
              <Button
                onClick={() => startRoundWith(selectedCollection, 'new', roundSize)}
                disabled={!seeded}
                className="w-full"
              >
                {seeded ? 'Start' : 'Loading...'}
              </Button>
            </div>
          </div>
        )}

        {/* In-round header with progress */}
        {state !== 'setup' && (
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <button
                onClick={async () => {
                  clearMcTimer();
                  setState('setup');
                  const counts = await getCollectionCounts();
                  setCollectionCounts(counts);
                }}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                &larr; Back
              </button>
              <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--gold-strong)]">
                <Star className="h-4 w-4" fill="currentColor" />
                {points.toLocaleString()}
              </span>
            </div>

            {/* Round progress bar */}
            <div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{COLLECTION_LABELS[selectedCollection]}</span>
                <span className="font-medium">
                  {roundProgress}/{roundSize}
                </span>
              </div>
              <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[color-mix(in_srgb,var(--primary)_55%,#fff)] to-primary transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Main content area */}
        {state !== 'setup' && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            {/* Loading state */}
            {state === 'loading' && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-muted border-t-primary" />
                <p className="text-muted-foreground">Loading sentences...</p>
              </div>
            )}

            {/* Practice state — dictation. Keyed by sentence id so the card
                remounts per sentence (fresh input, replay budget, autoplay). */}
            {state === 'practicing' && current && practiceFormat === 'dictation' && (
              <DictationCard
                key={current.sentence.id}
                current={current}
                onSubmit={(typed) => recordDictation(typed)}
                onSurrender={(typed) => recordDictation(typed, true)}
                onSentenceBlacklisted={handleSentenceBlacklisted}
              />
            )}

            {/* Practice state — cloze */}
            {state === 'practicing' &&
              current &&
              practiceFormat === 'cloze' &&
              (() => {
                const fuzzyStatus = getFuzzyStatus(userAnswer, current.sentence.clozeWord);
                const inputColorClass = {
                  empty: 'border-[var(--clay)] bg-[color-mix(in_srgb,var(--clay)_14%,var(--card))]',
                  match: 'border-primary bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))]',
                  partial: 'border-primary bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))]',
                  wrong:
                    'border-destructive bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))]',
                }[fuzzyStatus];

                const words = current.sentence.sentence.split(/\s+/);
                // The cloze token can carry trailing punctuation (e.g. "huis.") —
                // render it after the input/blank so it stays visible.
                const [clozeBase, clozePunct] = splitTrailingPunctuation(
                  words[current.sentence.clozeIndex] ?? '',
                );

                // Re-used in both the type and MC shortcut-hint rows below.
                const translationHint = (
                  <span className="inline-flex items-center gap-1.5">
                    <KbdGroup>
                      <Kbd>Alt</Kbd>
                      <Kbd>T</Kbd>
                    </KbdGroup>
                    Translation
                  </span>
                );

                return (
                  <div>
                    {/* Sentence with inline input or blank */}
                    <div className="mb-6">
                      <div className="mb-4 flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground">
                          {practiceMode === 'mc' || mcFallback
                            ? 'Choose the correct word'
                            : 'Fill in the blank'}
                        </span>
                        <BlacklistSentence
                          current={current}
                          onSentenceBlacklisted={handleSentenceBlacklisted}
                        />
                      </div>
                      <p className="text-xl leading-loose font-medium text-foreground">
                        {words.map((word, i) => (
                          <span key={i}>
                            {i > 0 && ' '}
                            {i === current.sentence.clozeIndex ? (
                              <>
                                {practiceMode === 'type' && !mcFallback ? (
                                  <input
                                    ref={inputRef}
                                    type="text"
                                    value={userAnswer}
                                    onChange={(e) => setUserAnswer(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.repeat) {
                                        e.preventDefault();
                                        handleSubmit();
                                      }
                                    }}
                                    autoComplete="off"
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    placeholder="..."
                                    className={`inline-block w-32 rounded-lg border-2 px-2 py-1 text-center text-xl font-medium transition-all outline-none focus:ring-2 focus:ring-offset-1 ${inputColorClass} ${fuzzyStatus === 'match' ? 'text-primary focus:ring-ring' : ''} ${fuzzyStatus === 'partial' ? 'text-primary focus:ring-ring' : ''} ${fuzzyStatus === 'wrong' ? 'text-destructive focus:ring-destructive' : ''} ${fuzzyStatus === 'empty' ? 'text-foreground focus:ring-ring' : ''} `}
                                    style={{ minWidth: `${Math.max(clozeBase.length * 0.7, 4)}ch` }}
                                  />
                                ) : (
                                  <span
                                    className="inline-block rounded-lg border-2 border-[var(--clay)] bg-[color-mix(in_srgb,var(--clay)_14%,var(--card))] px-3 py-1 text-center text-xl font-bold text-foreground"
                                    style={{ minWidth: `${Math.max(clozeBase.length * 0.7, 4)}ch` }}
                                  >
                                    _____
                                  </span>
                                )}
                                {clozePunct}
                              </>
                            ) : (
                              <span
                                data-testid="cloze-word"
                                onClick={() => handleWordClick(word)}
                                className="cursor-pointer rounded px-0.5 transition-colors hover:bg-accent hover:text-foreground"
                              >
                                {word}
                              </span>
                            )}
                          </span>
                        ))}
                      </p>
                      {/* English translation — hidden when the user chooses to
                          practise without it (toggle with Alt+T). */}
                      {showTranslation ? (
                        <p className="mt-3 text-base text-muted-foreground italic">
                          {current.sentence.translation}
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowTranslation(true)}
                          className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground italic transition-colors hover:text-foreground"
                        >
                          Show translation
                          <KbdGroup>
                            <Kbd>Alt</Kbd>
                            <Kbd>T</Kbd>
                          </KbdGroup>
                        </button>
                      )}
                    </div>

                    {/* Multiple choice options */}
                    {(practiceMode === 'mc' || mcFallback) && (
                      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {mcOptions.map((option, idx) => {
                          let btnClass = 'border-border bg-card text-foreground hover:bg-accent';

                          if (mcSelected !== null) {
                            if (idx === mcCorrectIdx) {
                              btnClass =
                                'border-primary bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] text-primary';
                            } else if (idx === mcSelected) {
                              btnClass =
                                'border-destructive bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] text-destructive';
                            } else {
                              btnClass = 'border-border bg-card text-muted-foreground opacity-60';
                            }
                          }

                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleMcSelect(idx)}
                              disabled={mcLocked}
                              className={`flex items-center gap-3 rounded-xl border-2 px-4 py-4 text-left text-lg font-medium transition-all active:scale-[0.98] ${btnClass}`}
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground">
                                {idx + 1}
                              </span>
                              {option}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Multiple-choice shortcut hints (real MC mode only — the
                        number keys aren't wired up for the per-question fallback) */}
                    {practiceMode === 'mc' && (
                      <div className="mb-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <KbdGroup>
                            <Kbd>1</Kbd>
                            <span aria-hidden>–</span>
                            <Kbd>4</Kbd>
                          </KbdGroup>
                          Choose
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Kbd>Space</Kbd>
                          Listen
                        </span>
                        {translationHint}
                      </div>
                    )}

                    {/* Type mode buttons */}
                    {practiceMode === 'type' && !mcFallback && (
                      <div className="flex justify-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            if (!current) return;
                            generateMcOptionsForSentence(current.sentence, queue);
                            setMcFallback(true);
                          }}
                          title="Switch to multiple choice for this question"
                        >
                          Multiple Choice
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleHint}
                          title="Reveal next letter"
                        >
                          Hint (
                          {hintLetters > 0
                            ? `${hintLetters} letter${hintLetters > 1 ? 's' : ''}`
                            : '?'}
                          )
                        </Button>
                        <Button
                          type="button"
                          size="lg"
                          onClick={handleSubmit}
                          disabled={!userAnswer.trim()}
                        >
                          {fuzzyStatus === 'match' ? 'Submit' : 'Check'}
                        </Button>
                      </div>
                    )}

                    {/* Type mode shortcut hints */}
                    {practiceMode === 'type' && !mcFallback && (
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Kbd>Enter</Kbd>
                          {fuzzyStatus === 'match' ? 'Submit' : 'Check'}
                        </span>
                        {translationHint}
                      </div>
                    )}

                    {/* Mastery indicator */}
                    <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <span>Mastery:</span>
                      <div className="flex h-2 w-24 overflow-hidden rounded-full bg-muted">
                        <div
                          className="bg-primary transition-all"
                          style={{ width: `${current.sentence.masteryLevel}%` }}
                        />
                      </div>
                      <span>{current.sentence.masteryLevel}%</span>
                    </div>
                  </div>
                );
              })()}

            {/* Feedback state — dictation */}
            {state === 'feedback' &&
              current &&
              practiceFormat === 'dictation' &&
              dictationResult && (
                <DictationFeedback
                  result={dictationResult}
                  translation={current.sentence.translation}
                  onNext={handleNext}
                  onSpeak={() => speak(current.sentence.sentence)}
                />
              )}

            {/* Feedback state — cloze */}
            {state === 'feedback' && current && practiceFormat === 'cloze' && feedbackData && (
              <Feedback
                feedbackData={feedbackData}
                current={current}
                onNext={handleNext}
                onWordClicked={handleWordClick}
              />
            )}

            {state === 'complete' && (
              <div className="py-8 text-center">
                <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] text-primary">
                  <CheckCircle className="h-8 w-8" />
                </div>
                <h2 className="mb-2 text-xl font-bold text-foreground">Round Complete!</h2>
                <p className="mb-1 text-muted-foreground">
                  {roundCorrect}/{roundProgress} correct
                </p>
                <p className="mb-6 text-sm text-muted-foreground">
                  {points.toLocaleString()} total points
                </p>
                <div className="flex justify-center gap-3">
                  <Button
                    variant={'secondary'}
                    type="button"
                    onClick={async () => {
                      setState('setup');
                      const counts = await getCollectionCounts();
                      setCollectionCounts(counts);
                    }}
                  >
                    Change Settings
                  </Button>
                  <Button type="button" onClick={startRound}>
                    Play Again
                  </Button>
                </div>
              </div>
            )}

            {state === 'empty' && (
              <EmptyState
                roundType={roundType}
                onBackPressed={handleBackPressed}
                onLearnNewPressed={handleNewRoundPressed}
              />
            )}
          </div>
        )}
      </main>
      <TranslationDrawer
        isOpen={!!wordTooltip}
        word={wordTooltip?.word ?? ''}
        sentence={current?.blankedSentence ?? ''}
        entry={wordTooltip?.dictEntry ?? null}
        aiTranslation={wordTooltip?.translation ?? null}
        aiPartOfSpeech={wordTooltip?.partOfSpeech ?? null}
        isDictionaryResult={!!wordTooltip?.dictEntry}
        isLoading={wordTooltip?.isLoading ?? false}
        isContextLoading={wordTooltip?.isContextLoading ?? false}
        onClose={() => setWordTooltip(null)}
        onSpeak={(text) => speak(text)}
        onRequestContextTranslation={requestContextTranslation}
        onLookupWord={handleWordClick}
      />
    </>
  );
}
