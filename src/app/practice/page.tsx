'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import NavHeader from '@/components/NavHeader';
import ClozeFeedback from '@/components/ClozeFeedback';
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
  blacklistClozeSentence,
  seedSentenceBank,
  updateWordState,
} from '@/lib/data-layer';
import { speak, isTTSAvailable } from '@/lib/tts';
import { playCorrectSound, playIncorrectSound } from '@/lib/sounds';
import { addClozeCard, isAnkiConnected } from '@/lib/anki';
import { translateWord } from '@/lib/claude';
import { lookupWord } from '@/lib/dictionary';

const ANKI_CLOZE_DECK_SETTING_KEY = 'lector-anki-cloze-deck';
const DEFAULT_ANKI_CLOZE_DECK = 'Afrikaans::Cloze';

// Strip trailing punctuation from a word, returning [cleanWord, punctuation]
function splitTrailingPunctuation(word: string): [string, string] {
  const match = word.match(/^(.+?)([.,!?;:'")\]]+)$/);
  if (match) return [match[1], match[2]];
  return [word, ''];
}

// Helper function to create blanked sentence, moving punctuation outside the blank
function createBlankedSentence(sentence: string, wordIndex: number): string {
  const words = sentence.split(/\s+/);
  const [, punct] = splitTrailingPunctuation(words[wordIndex]);
  words[wordIndex] = '_____' + punct;
  return words.join(' ');
}

// Helper function to normalize text for comparison
function normalize(s: string): string {
  return s.toLowerCase().replace(/[.,!?;:'")\]]/g, '').trim();
}

// Helper function to check answer (case-insensitive, ignores punctuation)
function checkAnswer(userAnswer: string, correctWord: string): boolean {
  return normalize(userAnswer) === normalize(correctWord);
}

// Fuzzy match status for live feedback
type FuzzyStatus = 'empty' | 'match' | 'partial' | 'wrong';

function getFuzzyStatus(userInput: string, correctWord: string): FuzzyStatus {
  if (!userInput.trim()) return 'empty';

  const input = normalize(userInput);
  const correct = normalize(correctWord);

  if (input === correct) return 'match';
  if (input.length <= correct.length && correct.startsWith(input)) return 'partial';

  return 'wrong';
}

// Calculate next review date based on mastery level
function calculateNextReview(mastery: ClozeMasteryLevel): Date {
  const now = new Date();
  const intervals: Record<ClozeMasteryLevel, number> = {
    0: 0,
    25: 1,
    50: 3,
    75: 7,
    100: 14,
  };
  const days = intervals[mastery];
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

// Calculate points for correct answer
function calculatePoints(mastery: ClozeMasteryLevel): number {
  const pointsMap: Record<ClozeMasteryLevel, number> = {
    0: 10,
    25: 15,
    50: 20,
    75: 25,
    100: 30,
  };
  return pointsMap[mastery];
}

// Generate distractors from the queue/pool of cloze words
function generateDistractors(
  correctWord: string,
  pool: ClozeSentence[],
): string[] {
  const correctNorm = normalize(correctWord);
  const correctLen = correctNorm.length;

  const candidates: string[] = [];
  const seen = new Set<string>();
  seen.add(correctNorm);

  for (const s of pool) {
    const norm = normalize(s.clozeWord);
    if (!seen.has(norm) && norm.length > 0) {
      seen.add(norm);
      candidates.push(s.clozeWord);
    }
  }

  // Sort by length similarity to the correct word
  candidates.sort((a, b) => {
    const diffA = Math.abs(normalize(a).length - correctLen);
    const diffB = Math.abs(normalize(b).length - correctLen);
    return diffA - diffB;
  });

  // Pick top candidates then shuffle
  const topCandidates = candidates.slice(0, Math.min(12, candidates.length));
  for (let i = topCandidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [topCandidates[i], topCandidates[j]] = [topCandidates[j], topCandidates[i]];
  }

  return topCandidates.slice(0, 3);
}

// Shuffle array (Fisher-Yates)
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

type PracticeState = 'setup' | 'loading' | 'practicing' | 'feedback' | 'complete' | 'empty';
type PracticeMode = 'type' | 'mc';

const ROUND_SIZES = [10, 20, 30, 40, 50] as const;
type RoundSize = typeof ROUND_SIZES[number];

interface CurrentSentence {
  sentence: ClozeSentence;
  blankedSentence: string;
}

const COLLECTION_LABELS: Record<string, string> = {
  top500: 'Top 500',
  top1000: '500-1000',
  top2000: '1000-2000',
};

const VISIBLE_COLLECTIONS: ClozeCollection[] = ['top500', 'top1000', 'top2000'];

type RoundType = 'new' | 'review';

export default function PracticePage() {
  // State
  const [state, setState] = useState<PracticeState>('setup');
  const [queue, setQueue] = useState<ClozeSentence[]>([]);
  const [current, setCurrent] = useState<CurrentSentence | null>(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [roundSize, setRoundSize] = useState<RoundSize>(20);
  const [roundProgress, setRoundProgress] = useState(0);
  const [roundCorrect, setRoundCorrect] = useState(0);
  const [points, setPoints] = useState(0);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [ankiConnected, setAnkiConnected] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Practice mode
  const [practiceMode, setPracticeMode] = useState<PracticeMode>('type');
  const [roundType, setRoundType] = useState<RoundType>('new');

  // Multiple choice state
  const [mcOptions, setMcOptions] = useState<string[]>([]);
  const [mcSelected, setMcSelected] = useState<number | null>(null);
  const [mcCorrectIdx, setMcCorrectIdx] = useState<number>(0);
  const [mcLocked, setMcLocked] = useState(false);
  const [mcFallback, setMcFallback] = useState(false); // Temporary MC switch from type mode

  // Collection state
  const [selectedCollection, setSelectedCollection] = useState<ClozeCollection>('top500');
  const [collectionCounts, setCollectionCounts] = useState<Record<ClozeCollection, { total: number; due: number; mastered: number }> | null>(null);
  const [recentWords, setRecentWords] = useState<string[]>([]);

  // Feedback state
  const [feedbackData, setFeedbackData] = useState<{
    isCorrect: boolean;
    correctWord: string;
    userAnswer: string;
    translation: string;
    points: number;
    newMastery: ClozeMasteryLevel;
    previousMastery: ClozeMasteryLevel;
  } | null>(null);
  const [isAddingToAnki, setIsAddingToAnki] = useState(false);
  const [ankiAdded, setAnkiAdded] = useState(false);
  const [ankiError, setAnkiError] = useState<string | null>(null);
  const [hintLetters, setHintLetters] = useState(0);
  const [retryQueue, setRetryQueue] = useState<ClozeSentence[]>([]);
  const [blacklistToast, setBlacklistToast] = useState(false);

  // Word definition tooltip state
  const [wordTooltip, setWordTooltip] = useState<{
    word: string;
    translation: string | null;
    partOfSpeech: string | null;
    isLoading: boolean;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  // Load collection counts and seed on mount
  useEffect(() => {
    const init = async () => {
      setTtsSupported(isTTSAvailable());
      const connected = await isAnkiConnected();
      setAnkiConnected(connected);

      const stats = await getTodayStats();
      setPoints(stats.points);

      // Load saved practice mode
      const savedMode = localStorage.getItem('cloze-practice-mode');
      if (savedMode === 'mc' || savedMode === 'type') {
        setPracticeMode(savedMode);
      }

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

  // Handle word click for inline definitions
  const handleWordClick = useCallback(async (word: string) => {
    if (!current) return;
    const [cleanWord] = splitTrailingPunctuation(word);
    if (!cleanWord) return;

    // Show loading state
    setWordTooltip({ word: cleanWord, translation: null, partOfSpeech: null, isLoading: true });

    // Try local dictionary first (instant, no network)
    const dictEntry = lookupWord(cleanWord);
    if (dictEntry) {
      setWordTooltip({
        word: cleanWord,
        translation: dictEntry.translation,
        partOfSpeech: dictEntry.partOfSpeech || null,
        isLoading: false,
      });
      return;
    }

    // Fall back to translate API
    try {
      const result = await translateWord(cleanWord, current.sentence.sentence);
      setWordTooltip({
        word: cleanWord,
        translation: result.translation,
        partOfSpeech: result.partOfSpeech || null,
        isLoading: false,
      });
    } catch {
      setWordTooltip({
        word: cleanWord,
        translation: null,
        partOfSpeech: null,
        isLoading: false,
      });
    }
  }, [current]);

  // Generate MC options when current sentence or queue changes
  const generateMcOptionsForSentence = useCallback((sentence: ClozeSentence, sentenceQueue: ClozeSentence[]) => {
    const distractors = generateDistractors(sentence.clozeWord, sentenceQueue);
    // Pad with fallback words if not enough distractors
    const fallbacks = ['die', 'het', 'van', 'wat', 'nie', 'kan', 'sal', 'met'];
    while (distractors.length < 3) {
      const fb = fallbacks.find(w => normalize(w) !== normalize(sentence.clozeWord) && !distractors.some(d => normalize(d) === normalize(w)));
      if (fb) distractors.push(fb);
      else break;
    }
    // Strip trailing punctuation from all options so punctuation doesn't give away the answer
    const cleanCorrect = splitTrailingPunctuation(sentence.clozeWord)[0];
    const cleanDistractors = distractors.slice(0, 3).map(d => splitTrailingPunctuation(d)[0]);
    const options = shuffle([cleanCorrect, ...cleanDistractors]);
    const correctIdx = options.findIndex(o => normalize(o) === normalize(cleanCorrect));
    setMcOptions(options);
    setMcCorrectIdx(correctIdx);
    setMcSelected(null);
    setMcLocked(false);
  }, []);

  // Load next sentence from queue
  const loadNextSentence = useCallback((sentenceQueue: ClozeSentence[]) => {
    if (sentenceQueue.length === 0) {
      setState('complete');
      return;
    }

    const nextSentence = sentenceQueue[0];
    const blankedSentence = createBlankedSentence(nextSentence.sentence, nextSentence.clozeIndex);

    setCurrent({ sentence: nextSentence, blankedSentence });
    setUserAnswer('');
    setFeedbackData(null);
    setAnkiAdded(false);
    setAnkiError(null);
    setHintLetters(0);
    setMcFallback(false);
    setWordTooltip(null);
    submittingRef.current = false;
    setState('practicing');

    // Generate MC options if in MC mode
    if (practiceMode === 'mc') {
      generateMcOptionsForSentence(nextSentence, sentenceQueue);
    }

    // Focus input after state update (only in type mode)
    if (practiceMode === 'type') {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [practiceMode, generateMcOptionsForSentence]);

  // Start a round with explicit params (used by review buttons)
  const startRoundWith = useCallback(async (collection: ClozeCollection, type: RoundType, size: number) => {
    setState('loading');
    setSelectedCollection(collection);
    setRoundType(type);
    setRoundSize(size as RoundSize);
    setRoundProgress(0);
    setRoundCorrect(0);
    setRetryQueue([]);
    setRecentWords([]);

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
  }, [loadNextSentence]);

  // Start a round using current state values
  const startRound = useCallback(() => {
    startRoundWith(selectedCollection, roundType, roundSize);
  }, [selectedCollection, roundType, roundSize, startRoundWith]);

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
    setHintLetters(revealCount);
    setUserAnswer(correctWord.slice(0, revealCount));
    inputRef.current?.focus();
  }, [current, hintLetters, userAnswer]);

  // Handle blacklisting a sentence
  const handleBlacklist = useCallback(async () => {
    if (!current) return;
    await blacklistClozeSentence(current.sentence.id);
    setBlacklistToast(true);
    setTimeout(() => setBlacklistToast(false), 1500);

    const remainingQueue = queue.slice(1);
    setQueue(remainingQueue);

    if (remainingQueue.length > 0) {
      loadNextSentence(remainingQueue);
    } else if (retryQueue.length > 0) {
      const retryList = [...retryQueue];
      setRetryQueue([]);
      setQueue(retryList);
      loadNextSentence(retryList);
    } else {
      setState('complete');
    }
  }, [current, queue, retryQueue, loadNextSentence]);


  // Core submission logic (shared between type and MC modes)
  const processAnswer = async (submittedAnswer: string) => {
    if (!current || submittingRef.current) return;
    submittingRef.current = true;

    const isCorrect = checkAnswer(submittedAnswer, current.sentence.clozeWord);
    const previousMastery = current.sentence.masteryLevel;

    // Sound effects
    if (isCorrect) {
      playCorrectSound();
    } else {
      playIncorrectSound();
    }

    let newMastery: ClozeMasteryLevel;
    if (isCorrect) {
      newMastery = Math.min(previousMastery + 25, 100) as ClozeMasteryLevel;
    } else {
      newMastery = 0;
    }

    const earnedPoints = isCorrect ? calculatePoints(previousMastery) : 0;
    const nextReview = calculateNextReview(newMastery);

    // Update database
    await updateClozeAfterReview(current.sentence.id, isCorrect, newMastery, nextReview);
    if (newMastery === 100) {
      await updateWordState(current.sentence.clozeWord, 'known');
    }
    await incrementDailyStat('clozePracticed');
    if (earnedPoints > 0) {
      await incrementDailyStat('points', earnedPoints);
    }

    // Update local state
    setRoundProgress((prev) => prev + 1);
    if (isCorrect) setRoundCorrect((prev) => prev + 1);
    if (earnedPoints > 0) {
      setPoints((prev) => prev + earnedPoints);
    }

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
    } else {
      // Add to retry queue so incorrect answers are re-tested
      setRetryQueue(prev => [...prev, current.sentence]);
    }
  };

  // Handle answer submission (type mode)
  const handleSubmit = async () => {
    if (!current || !userAnswer.trim()) return;
    await processAnswer(userAnswer.trim());
  };

  // Handle MC option selection
  const handleMcSelect = useCallback((index: number) => {
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

    // Delay then submit (without duplicate sound)
    const delay = isCorrect ? 600 : 1200;
    setTimeout(async () => {
      if (!current) return;

      const previousMastery = current.sentence.masteryLevel;
      let newMastery: ClozeMasteryLevel;
      if (isCorrect) {
        newMastery = Math.min(previousMastery + 25, 100) as ClozeMasteryLevel;
      } else {
        newMastery = 0;
      }

      const earnedPoints = isCorrect ? calculatePoints(previousMastery) : 0;
      const nextReview = calculateNextReview(newMastery);

      await updateClozeAfterReview(current.sentence.id, isCorrect, newMastery, nextReview);
      if (newMastery === 100) {
        await updateWordState(current.sentence.clozeWord, 'known');
      }
      await incrementDailyStat('clozePracticed');
      if (earnedPoints > 0) {
        await incrementDailyStat('points', earnedPoints);
      }

      setRoundProgress((prev) => prev + 1);
      if (isCorrect) setRoundCorrect((prev) => prev + 1);
      if (earnedPoints > 0) {
        setPoints((prev) => prev + earnedPoints);
      }

      setFeedbackData({
        isCorrect,
        correctWord: splitTrailingPunctuation(current.sentence.clozeWord)[0],
        userAnswer: selectedWord,
        translation: current.sentence.translation,
        points: earnedPoints,
        newMastery,
        previousMastery,
      });

      setState('feedback');

      if (isCorrect) {
        speak(current.sentence.sentence);
      }
    }, delay);
  }, [mcLocked, current, mcOptions, mcCorrectIdx]);

  // Handle next sentence
  const handleNext = useCallback(async () => {
    if (current) {
      setRecentWords(prev => {
        const updated = [current.sentence.clozeWord.toLowerCase(), ...prev].slice(0, 10);
        return updated;
      });
    }

    const remainingQueue = queue.slice(1);
    setQueue(remainingQueue);

    if (remainingQueue.length > 0) {
      loadNextSentence(remainingQueue);
    } else if (retryQueue.length > 0) {
      const retryList = [...retryQueue];
      setRetryQueue([]);
      setQueue(retryList);
      loadNextSentence(retryList);
    } else {
      setState('complete');
    }
  }, [current, queue, retryQueue, loadNextSentence]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (state === 'feedback') {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); handleNext(); }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    if (state === 'practicing' && practiceMode === 'mc' && !mcLocked) {
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
    if (state === 'practicing' && practiceMode === 'type') {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === ' ' && document.activeElement !== inputRef.current) {
          e.preventDefault();
          if (current) speak(current.sentence.sentence);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [state, handleNext, practiceMode, mcLocked, mcOptions, handleMcSelect, current]);

  // Handle add to Anki
  const handleAddToAnki = async () => {
    if (!current || !feedbackData || !feedbackData.isCorrect || isAddingToAnki || ankiAdded) {
      return;
    }

    setIsAddingToAnki(true);
    setAnkiError(null);
    try {
      const deckName = localStorage.getItem(ANKI_CLOZE_DECK_SETTING_KEY) || DEFAULT_ANKI_CLOZE_DECK;

      await addClozeCard(
        deckName,
        current.sentence.sentence,
        current.sentence.clozeWord,
        current.sentence.translation,
        current.sentence.clozeWord
      );
      setAnkiAdded(true);
    } catch (error) {
      console.error('Failed to add to Anki:', error);
      const message = error instanceof Error ? error.message : 'Failed to add to Anki';
      setAnkiError(message);
    } finally {
      setIsAddingToAnki(false);
    }
  };

  // Handle TTS
  const handleSpeak = () => {
    if (!current) return;
    speak(current.sentence.sentence);
  };

  const progressPercent = roundSize > 0 ? Math.min((roundProgress / roundSize) * 100, 100) : 0;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 sm:ml-56">
      <NavHeader />

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Setup screen */}
        {state === 'setup' && (
          <div className="py-6">
            <h1 className="mb-6 text-2xl font-bold text-zinc-900 dark:text-zinc-50 text-center">Cloze Practice</h1>

            {/* Review Due section */}
            {(() => {
              const totalDue = VISIBLE_COLLECTIONS.reduce((sum, c) => sum + (collectionCounts?.[c]?.due || 0), 0);
              if (totalDue === 0) return null;
              return (
                <div className="mb-8 rounded-2xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-5">
                  <h2 className="text-base font-semibold text-amber-800 dark:text-amber-300 mb-3">
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
                          className="w-full flex items-center justify-between rounded-xl px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-amber-400 dark:hover:border-amber-600 transition-all active:scale-[0.98]"
                        >
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">{COLLECTION_LABELS[coll]}</span>
                          <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{due} due</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Learn New section */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Learn New</h2>

              {/* Collection */}
              <div className="mb-4">
                <div className="flex gap-2">
                  {VISIBLE_COLLECTIONS.map((coll) => {
                    const count = collectionCounts?.[coll];
                    return (
                      <button
                        key={coll}
                        onClick={() => setSelectedCollection(coll)}
                        className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all ${
                          selectedCollection === coll
                            ? 'bg-blue-500 text-white shadow-md'
                            : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                        }`}
                      >
                        <div>{COLLECTION_LABELS[coll]}</div>
                        {count && count.total > 0 && (
                          <div className="text-[11px] font-normal opacity-75 mt-0.5">
                            {count.mastered}/{count.total} mastered
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Round size + Mode in a row */}
              <div className="flex gap-4 mb-4">
                <div className="flex-1">
                  <label className="mb-2 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Sentences</label>
                  <div className="flex gap-1.5">
                    {ROUND_SIZES.map((size) => (
                      <button
                        key={size}
                        onClick={() => setRoundSize(size)}
                        className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                          roundSize === size
                            ? 'bg-blue-500 text-white'
                            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="w-40">
                  <label className="mb-2 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Mode</label>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleSetPracticeMode('type')}
                      className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                        practiceMode === 'type'
                          ? 'bg-blue-500 text-white'
                          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                      }`}
                    >
                      Type
                    </button>
                    <button
                      onClick={() => handleSetPracticeMode('mc')}
                      className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                        practiceMode === 'mc'
                          ? 'bg-blue-500 text-white'
                          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                      }`}
                    >
                      MC
                    </button>
                  </div>
                </div>
              </div>

              {/* Start button */}
              <button
                onClick={() => startRoundWith(selectedCollection, 'new', roundSize)}
                disabled={!seeded}
                className="w-full rounded-xl bg-blue-600 py-3.5 text-lg font-bold text-white transition-all hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {seeded ? 'Start' : 'Loading...'}
              </button>
            </div>
          </div>
        )}

        {/* In-round header with progress */}
        {state !== 'setup' && (
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <button
                onClick={async () => { setState('setup'); const counts = await getCollectionCounts(); setCollectionCounts(counts); }}
                className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
              >
                &larr; Back
              </button>
              <span className="flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                {points.toLocaleString()}
              </span>
            </div>

            {/* Round progress bar */}
            <div>
              <div className="flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
                <span>{COLLECTION_LABELS[selectedCollection]}</span>
                <span className="font-medium">{roundProgress}/{roundSize}</span>
              </div>
              <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Main content area */}
        {state !== 'setup' && <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {/* Loading state */}
          {state === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-blue-500 dark:border-zinc-700 dark:border-t-blue-400" />
              <p className="text-zinc-500 dark:text-zinc-400">Loading sentences...</p>
            </div>
          )}

          {/* Practice state */}
          {state === 'practicing' && current && (() => {
            const fuzzyStatus = getFuzzyStatus(userAnswer, current.sentence.clozeWord);
            const inputColorClass = {
              empty: 'border-blue-400 bg-blue-50 dark:bg-blue-950/50',
              match: 'border-green-500 bg-green-50 dark:bg-green-950/50',
              partial: 'border-green-400 bg-green-50/50 dark:bg-green-950/30',
              wrong: 'border-red-400 bg-red-50 dark:bg-red-950/50',
            }[fuzzyStatus];

            const words = current.sentence.sentence.split(/\s+/);

            return (
              <div>
                {/* Sentence with inline input or blank */}
                <div className="mb-6">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                      {practiceMode === 'mc' || mcFallback ? 'Choose the correct word' : 'Fill in the blank'}
                    </span>
                    <button
                      type="button"
                      onClick={handleBlacklist}
                      className="rounded p-1 text-zinc-400 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-red-400 transition-colors"
                      title="Skip &amp; hide this sentence"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-xl font-medium leading-loose text-zinc-900 dark:text-zinc-50">
                    {words.map((word, i) => (
                      <span key={i}>
                        {i > 0 && ' '}
                        {i === current.sentence.clozeIndex ? (
                          practiceMode === 'type' && !mcFallback ? (
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

                              className={`inline-block w-32 rounded-lg border-2 px-2 py-1 text-center text-xl font-medium outline-none transition-all
                                focus:ring-2 focus:ring-offset-1
                                ${inputColorClass}
                                ${fuzzyStatus === 'match' ? 'text-green-700 dark:text-green-300 focus:ring-green-400' : ''}
                                ${fuzzyStatus === 'partial' ? 'text-green-600 dark:text-green-400 focus:ring-green-400' : ''}
                                ${fuzzyStatus === 'wrong' ? 'text-red-600 dark:text-red-400 focus:ring-red-400' : ''}
                                ${fuzzyStatus === 'empty' ? 'text-zinc-900 dark:text-zinc-100 focus:ring-blue-400' : ''}
                              `}
                              style={{ minWidth: `${Math.max(word.length * 0.7, 4)}ch` }}
                            />
                          ) : (
                            <span
                              className="inline-block rounded-lg border-2 border-blue-400 bg-blue-50 px-3 py-1 text-center text-xl font-bold text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"
                              style={{ minWidth: `${Math.max(word.length * 0.7, 4)}ch` }}
                            >
                              _____
                            </span>
                          )
                        ) : (
                          <span
                            data-testid="cloze-word"
                            onClick={() => handleWordClick(word)}
                            className="cursor-pointer rounded px-0.5 transition-colors hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/40 dark:hover:text-blue-300"
                          >
                            {word}
                          </span>
                        )}
                      </span>
                    ))}
                  </p>
                  {/* English translation */}
                  <p className="mt-3 text-base text-zinc-500 dark:text-zinc-400 italic">
                    {current.sentence.translation}
                  </p>
                </div>

                {/* Multiple choice options */}
                {(practiceMode === 'mc' || mcFallback) && (
                  <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {mcOptions.map((option, idx) => {
                      let btnClass = 'border-zinc-200 bg-zinc-50 text-zinc-900 hover:bg-zinc-100 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';

                      if (mcSelected !== null) {
                        if (idx === mcCorrectIdx) {
                          btnClass = 'border-green-500 bg-green-50 text-green-800 dark:border-green-400 dark:bg-green-950/50 dark:text-green-200';
                        } else if (idx === mcSelected) {
                          btnClass = 'border-red-500 bg-red-50 text-red-800 dark:border-red-400 dark:bg-red-950/50 dark:text-red-200';
                        } else {
                          btnClass = 'border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500';
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
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                            {idx + 1}
                          </span>
                          {option}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Type mode buttons */}
                {practiceMode === 'type' && !mcFallback && (
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!current) return;
                        generateMcOptionsForSentence(current.sentence, queue);
                        setMcFallback(true);
                      }}
                      className="rounded-xl px-4 py-3 text-sm font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 dark:text-purple-400 dark:bg-purple-950/30 dark:hover:bg-purple-950/50 transition-all"
                      title="Switch to multiple choice for this question"
                    >
                      Multiple Choice
                    </button>
                    <button
                      type="button"
                      onClick={handleHint}
                      className="rounded-xl px-4 py-3 text-sm font-medium text-zinc-600 bg-zinc-100 hover:bg-zinc-200 dark:text-zinc-400 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition-all"
                      title="Reveal next letter"
                    >
                      Hint ({hintLetters > 0 ? `${hintLetters} letter${hintLetters > 1 ? 's' : ''}` : '?'})
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={!userAnswer.trim()}
                      className={`rounded-xl px-6 py-3 text-lg font-semibold transition-all
                        ${fuzzyStatus === 'match'
                          ? 'bg-green-600 text-white hover:bg-green-700 active:scale-95 dark:bg-green-500 dark:hover:bg-green-600'
                          : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95 dark:bg-blue-500 dark:hover:bg-blue-600'
                        } disabled:opacity-40`}
                    >
                      {fuzzyStatus === 'match' ? 'Submit' : 'Check'}
                    </button>
                  </div>
                )}

                {/* TTS hint (MC mode) */}
                {(practiceMode === 'mc' || mcFallback) && !mcLocked && ttsSupported && (
                  <div className="flex justify-center mb-2">
                    <button
                      type="button"
                      onClick={handleSpeak}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      </svg>
                      Listen (Space)
                    </button>
                  </div>
                )}

                {/* Mastery indicator */}
                <div className="mt-6 flex items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <span>Mastery:</span>
                  <div className="flex h-2 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                    <div
                      className="bg-blue-500 transition-all"
                      style={{ width: `${current.sentence.masteryLevel}%` }}
                    />
                  </div>
                  <span>{current.sentence.masteryLevel}%</span>
                </div>
              </div>
            );
          })()}

          {/* Feedback state */}
          {state === 'feedback' && current && feedbackData && (
            <div>
              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                    {feedbackData.isCorrect ? 'Correct!' : 'Incorrect'}
                  </span>
                  {ttsSupported && feedbackData.isCorrect && (
                    <button
                      type="button"
                      onClick={handleSpeak}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      </svg>
                      Listen Again
                    </button>
                  )}
                </div>
                <p className="text-xl font-medium leading-relaxed text-zinc-900 dark:text-zinc-50">
                  {current.sentence.sentence.split(/\s+/).map((word, i) => (
                    <span key={i}>
                      {i > 0 && ' '}
                      {i === current.sentence.clozeIndex ? (
                        <span
                          data-testid="cloze-word"
                          onClick={() => handleWordClick(word)}
                          className={`cursor-pointer rounded px-1 font-bold ${
                          feedbackData.isCorrect
                            ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/50 dark:text-green-300 dark:hover:bg-green-900/70'
                            : 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-300 dark:hover:bg-red-900/70'
                        }`}>
                          {word}
                        </span>
                      ) : (
                        <span
                          data-testid="cloze-word"
                          onClick={() => handleWordClick(word)}
                          className="cursor-pointer rounded px-0.5 transition-colors hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/40 dark:hover:text-blue-300"
                        >
                          {word}
                        </span>
                      )}
                    </span>
                  ))}
                </p>
                <p className="mt-2 text-base text-zinc-500 dark:text-zinc-400 italic">
                  {current.sentence.translation}
                </p>
              </div>

              <ClozeFeedback
                isCorrect={feedbackData.isCorrect}
                correctWord={feedbackData.correctWord}
                userAnswer={feedbackData.userAnswer}
                translation={feedbackData.translation}
                sentence={current.sentence.sentence}
                points={feedbackData.points}
                newMastery={feedbackData.newMastery}
                previousMastery={feedbackData.previousMastery}
                onNext={handleNext}
                onAddToAnki={handleAddToAnki}
                isAddingToAnki={isAddingToAnki}
                ankiAdded={ankiAdded}
                ankiError={ankiError}
              />
            </div>
          )}

          {/* Complete state */}
          {state === 'complete' && (
            <div className="py-8 text-center">
              <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400">
                <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="mb-2 text-xl font-bold text-zinc-900 dark:text-zinc-50">
                Round Complete!
              </h2>
              <p className="mb-1 text-zinc-500 dark:text-zinc-400">
                {roundCorrect}/{roundProgress} correct
              </p>
              <p className="mb-6 text-sm text-zinc-400 dark:text-zinc-500">
                {points.toLocaleString()} total points
              </p>
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={async () => { setState('setup'); const counts = await getCollectionCounts(); setCollectionCounts(counts); }}
                  className="rounded-xl px-6 py-3 font-semibold text-zinc-700 bg-zinc-200 hover:bg-zinc-300 transition-all active:scale-95 dark:text-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                >
                  Change Settings
                </button>
                <button
                  type="button"
                  onClick={startRound}
                  className="rounded-xl px-6 py-3 font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-all active:scale-95 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  Play Again
                </button>
              </div>
            </div>
          )}

          {/* Empty state - no sentences available */}
          {state === 'empty' && (
            <div className="py-8 text-center">
              <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400">
                <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="mb-2 text-xl font-bold text-zinc-900 dark:text-zinc-50">
                {roundType === 'review' ? 'Nothing to Review' : 'No New Sentences'}
              </h2>
              <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">
                {roundType === 'review'
                  ? 'No sentences are due for review right now. Try learning new ones or check back later.'
                  : 'You\'ve seen all the sentences in this collection. Try a different collection or review existing ones.'}
              </p>
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={async () => { setState('setup'); const counts = await getCollectionCounts(); setCollectionCounts(counts); }}
                  className="rounded-xl px-6 py-3 font-semibold text-zinc-700 bg-zinc-200 hover:bg-zinc-300 transition-all active:scale-95 dark:text-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                >
                  Back
                </button>
                {roundType === 'review' && (
                  <button
                    type="button"
                    onClick={() => startRoundWith(selectedCollection, 'new', roundSize)}
                    className="rounded-xl px-6 py-3 font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-all active:scale-95 dark:bg-blue-500 dark:hover:bg-blue-600"
                  >
                    Learn New Instead
                  </button>
                )}
              </div>
            </div>
          )}
        </div>}

        {/* Blacklist toast */}
        {blacklistToast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-200 dark:text-zinc-900">
            Sentence hidden
          </div>
        )}

      </main>

      {/* Word definition tooltip bar */}
      {wordTooltip && (
        <div
          data-testid="word-definition-popup"
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
        >
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {wordTooltip.word}
                </span>
                {wordTooltip.partOfSpeech && (
                  <span className="text-xs italic text-zinc-500 dark:text-zinc-400">
                    {wordTooltip.partOfSpeech}
                  </span>
                )}
                <span className="text-zinc-400 dark:text-zinc-500">&rarr;</span>
                {wordTooltip.isLoading ? (
                  <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                  </span>
                ) : (
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {wordTooltip.translation || 'No translation found'}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setWordTooltip(null)}
              className="rounded p-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-700"
              title="Close"
            >
              <svg className="h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
