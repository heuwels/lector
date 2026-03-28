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
import { addClozeCard, isAnkiConnected } from '@/lib/anki';

const ANKI_CLOZE_DECK_SETTING_KEY = 'afrikaans-reader-anki-cloze-deck';
const DEFAULT_ANKI_CLOZE_DECK = 'Afrikaans::Cloze';

// Helper function to create blanked sentence
function createBlankedSentence(sentence: string, wordIndex: number): string {
  const words = sentence.split(/\s+/);
  words[wordIndex] = '_____';
  return words.join(' ');
}

// Helper function to normalize text for comparison
function normalize(s: string): string {
  return s.toLowerCase().replace(/[.,!?;:'"]/g, '').trim();
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

  // Exact match
  if (input === correct) return 'match';

  // Check if input is a prefix of the correct word (on track, but not too long)
  if (input.length <= correct.length && correct.startsWith(input)) return 'partial';

  // Input is longer than correct word — wrong
  if (input.length > correct.length) return 'wrong';

  // Check if they share a common prefix of at least 2 chars (typo tolerance)
  const commonPrefixLength = [...input].findIndex((char, i) => correct[i] !== char);
  if (commonPrefixLength >= 2 && commonPrefixLength >= input.length * 0.6) return 'partial';

  return 'wrong';
}

// Calculate next review date based on mastery level
function calculateNextReview(mastery: ClozeMasteryLevel): Date {
  const now = new Date();
  const intervals: Record<ClozeMasteryLevel, number> = {
    0: 0,     // Review immediately (same session)
    25: 1,    // 1 day
    50: 3,    // 3 days
    75: 7,    // 1 week
    100: 14,  // 2 weeks
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

type PracticeState = 'setup' | 'loading' | 'practicing' | 'feedback' | 'complete';

const ROUND_SIZES = [10, 20, 30, 40, 50] as const;
type RoundSize = typeof ROUND_SIZES[number];

interface CurrentSentence {
  sentence: ClozeSentence;
  blankedSentence: string;
}

const COLLECTION_LABELS: Record<ClozeCollection, string> = {
  top500: 'Top 500 Words',
  top1000: 'Words 500-1000',
  top2000: 'Words 1000-2000',
  mined: 'From Reading',
  random: 'Random',
};

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
  const [showingAnswer, setShowingAnswer] = useState(false);
  const [retryQueue, setRetryQueue] = useState<ClozeSentence[]>([]);
  const [blacklistToast, setBlacklistToast] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Load collection counts and seed on mount
  useEffect(() => {
    const init = async () => {
      setTtsSupported(isTTSAvailable());
      const connected = await isAnkiConnected();
      setAnkiConnected(connected);

      const stats = await getTodayStats();
      setPoints(stats.points);

      await migrateClozeSentences();
      await seedSentenceBank();
      setSeeded(true);

      const counts = await getCollectionCounts();
      setCollectionCounts(counts);
    };
    init();
  }, []);

  // Start a round
  const startRound = useCallback(async () => {
    setState('loading');
    setRoundProgress(0);
    setRoundCorrect(0);
    setRetryQueue([]);
    setRecentWords([]);

    try {
      // Load due sentences first, then new ones to fill the round
      const dueSentences = await getClozeSentencesByCollection(selectedCollection, roundSize, []);

      let sentences = dueSentences;
      if (sentences.length < roundSize) {
        const newSentences = await getNewSentencesByCollection(selectedCollection, roundSize - sentences.length, []);
        sentences = [...sentences, ...newSentences];
      }

      // Shuffle to avoid clusters of the same cloze word
      for (let i = sentences.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sentences[i], sentences[j]] = [sentences[j], sentences[i]];
      }

      if (sentences.length > 0) {
        setQueue(sentences);
        loadNextSentence(sentences);
      } else {
        setState('complete');
      }
    } catch (error) {
      console.error('Failed to start round:', error);
      setState('complete');
    }
  }, [selectedCollection, roundSize]);

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
    setShowingAnswer(false);
    setState('practicing');

    // Focus input after state update
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Handle hint - reveal next letter
  const handleHint = useCallback(() => {
    if (!current) return;
    const correctWord = normalize(current.sentence.clozeWord);
    const nextHintCount = Math.min(hintLetters + 1, correctWord.length);
    setHintLetters(nextHintCount);
    // Pre-fill the input with hint letters
    setUserAnswer(correctWord.slice(0, nextHintCount));
    inputRef.current?.focus();
  }, [current, hintLetters]);

  // Handle "give up" - show answer but add to retry queue
  const handleShowAnswer = useCallback(() => {
    if (!current) return;
    setShowingAnswer(true);
    // Add to retry queue (will see it again later)
    setRetryQueue(prev => [...prev, current.sentence]);
  }, [current]);

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

  // Continue after seeing the answer
  const handleContinueAfterShow = useCallback(() => {
    setShowingAnswer(false);
    const remainingQueue = queue.slice(1);
    setQueue(remainingQueue);

    if (remainingQueue.length > 0) {
      loadNextSentence(remainingQueue);
    } else if (retryQueue.length > 0) {
      // Process retry queue
      const nextRetry = retryQueue[0];
      setRetryQueue(prev => prev.slice(1));
      loadNextSentence([nextRetry]);
    } else {
      setState('complete');
    }
  }, [queue, retryQueue, loadNextSentence]);

  // Handle answer submission
  const handleSubmit = async () => {
    if (!current || !userAnswer.trim()) return;

    const isCorrect = checkAnswer(userAnswer.trim(), current.sentence.clozeWord);
    const previousMastery = current.sentence.masteryLevel;

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

    // Set feedback data
    setFeedbackData({
      isCorrect,
      correctWord: current.sentence.clozeWord,
      userAnswer: userAnswer.trim(),
      translation: current.sentence.translation,
      points: earnedPoints,
      newMastery,
      previousMastery,
    });

    setState('feedback');

    // Auto-play audio on correct answer
    if (isCorrect) {
      speak(current.sentence.sentence);
    }
  };

  // Handle next sentence
  const handleNext = useCallback(async () => {
    // Track recently used words for anti-clumping (keep last 10)
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
      // Process retry queue first
      const retryList = [...retryQueue];
      setRetryQueue([]);
      setQueue(retryList);
      loadNextSentence(retryList);
    } else {
      setState('complete');
    }
  }, [current, queue, retryQueue, loadNextSentence]);

  // Handle Enter key in feedback state or showing-answer state
  useEffect(() => {
    if (state === 'feedback') {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); handleNext(); }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    if (state === 'practicing' && showingAnswer) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); handleContinueAfterShow(); }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [state, showingAnswer, handleNext, handleContinueAfterShow]);

  // Handle add to Anki
  const handleAddToAnki = async () => {
    console.log('[Anki] handleAddToAnki called', {
      hasCurrent: !!current,
      hasFeedback: !!feedbackData,
      isCorrect: feedbackData?.isCorrect,
      isAddingToAnki,
      ankiAdded
    });
    if (!current || !feedbackData || !feedbackData.isCorrect || isAddingToAnki || ankiAdded) {
      console.log('[Anki] Returning early from handleAddToAnki');
      return;
    }

    setIsAddingToAnki(true);
    setAnkiError(null);
    try {
      // Get cloze deck name from settings or use default
      const deckName = localStorage.getItem(ANKI_CLOZE_DECK_SETTING_KEY) || DEFAULT_ANKI_CLOZE_DECK;

      await addClozeCard(
        deckName,
        current.sentence.sentence,
        current.sentence.clozeWord,
        current.sentence.translation,
        current.sentence.clozeWord // Word meaning could be enhanced with translation
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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavHeader />

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Setup screen — choose round size and collection */}
        {state === 'setup' && (
          <div className="py-8">
            <h1 className="mb-8 text-2xl font-bold text-zinc-900 dark:text-zinc-50 text-center">Cloze Practice</h1>

            {/* Collection selector */}
            <div className="mb-8">
              <label className="mb-3 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Collection</label>
              <div className="flex flex-wrap gap-2">
                {(['top500', 'top1000', 'top2000', 'mined', 'random'] as ClozeCollection[]).map((coll) => {
                  const count = collectionCounts?.[coll];
                  return (
                    <button
                      key={coll}
                      onClick={() => setSelectedCollection(coll)}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                        selectedCollection === coll
                          ? 'bg-blue-500 text-white'
                          : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {COLLECTION_LABELS[coll]}
                      {count && count.total > 0 && (
                        <span className="ml-1.5 text-xs opacity-75">
                          ({count.total})
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Round size selector */}
            <div className="mb-8">
              <label className="mb-3 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Sentences per round</label>
              <div className="flex gap-2">
                {ROUND_SIZES.map((size) => (
                  <button
                    key={size}
                    onClick={() => setRoundSize(size)}
                    className={`flex-1 rounded-xl py-3 text-lg font-semibold transition-all ${
                      roundSize === size
                        ? 'bg-blue-500 text-white shadow-md scale-105'
                        : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Start button */}
            <button
              onClick={startRound}
              disabled={!seeded}
              className="w-full rounded-xl bg-blue-600 py-4 text-xl font-bold text-white transition-all hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {seeded ? 'Start Round' : 'Loading...'}
            </button>
          </div>
        )}

        {/* In-round header with progress */}
        {state !== 'setup' && (
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <button
                onClick={() => setState('setup')}
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
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
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
                {/* Sentence with inline input */}
                <div className="mb-6">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                      Fill in the blank
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
                          <input
                            ref={inputRef}
                            type="text"
                            value={userAnswer}
                            onChange={(e) => setUserAnswer(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (fuzzyStatus === 'match') {
                                  handleSubmit();
                                } else {
                                  // Show answer and retry later
                                  handleShowAnswer();
                                }
                              }
                            }}
                            autoComplete="off"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                            placeholder="..."
                            disabled={showingAnswer}
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
                          word
                        )}
                      </span>
                    ))}
                  </p>
                  {/* English translation */}
                  <p className="mt-3 text-base text-zinc-500 dark:text-zinc-400 italic">
                    {current.sentence.translation}
                  </p>
                </div>

                {/* Showing answer overlay */}
                {showingAnswer && (
                  <div className="mb-4 rounded-xl bg-amber-50 border-2 border-amber-200 p-4 dark:bg-amber-950/30 dark:border-amber-800">
                    <p className="text-center text-lg font-medium text-amber-800 dark:text-amber-200">
                      The answer was: <span className="font-bold">{current.sentence.clozeWord}</span>
                    </p>
                    <p className="text-center text-sm text-amber-600 dark:text-amber-400 mt-1">
                      You&apos;ll see this sentence again later
                    </p>
                    <div className="flex justify-center mt-3">
                      <button
                        type="button"
                        onClick={handleContinueAfterShow}
                        className="rounded-lg bg-amber-500 px-6 py-2 text-white font-medium hover:bg-amber-600 active:scale-95 transition-all"
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                )}

                {/* Buttons */}
                {!showingAnswer && (
                  <div className="flex justify-center gap-3">
                    {/* Hint button */}
                    <button
                      type="button"
                      onClick={handleHint}
                      className="rounded-xl px-4 py-3 text-sm font-medium text-zinc-600 bg-zinc-100 hover:bg-zinc-200 dark:text-zinc-400 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition-all"
                      title="Reveal next letter"
                    >
                      Hint ({hintLetters > 0 ? `${hintLetters} letter${hintLetters > 1 ? 's' : ''}` : '?'})
                    </button>

                    {/* Check/Submit button */}
                    <button
                      type="button"
                      onClick={fuzzyStatus === 'match' ? handleSubmit : handleShowAnswer}
                      className={`rounded-xl px-8 py-3 text-lg font-semibold transition-all
                        ${fuzzyStatus === 'match'
                          ? 'bg-green-600 text-white hover:bg-green-700 active:scale-95 dark:bg-green-500 dark:hover:bg-green-600'
                          : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95 dark:bg-blue-500 dark:hover:bg-blue-600'
                        }`}
                    >
                      {fuzzyStatus === 'match' ? 'Submit' : 'Check'}
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
              {/* Show the full sentence with highlighted word */}
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
                        <span className={`rounded px-1 font-bold ${
                          feedbackData.isCorrect
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                        }`}>
                          {word}
                        </span>
                      ) : (
                        word
                      )}
                    </span>
                  ))}
                </p>
                {/* English translation */}
                <p className="mt-2 text-base text-zinc-500 dark:text-zinc-400 italic">
                  {current.sentence.translation}
                </p>
              </div>

              {/* Feedback component */}
              <ClozeFeedback
                isCorrect={feedbackData.isCorrect}
                correctWord={feedbackData.correctWord}
                userAnswer={feedbackData.userAnswer}
                translation={feedbackData.translation}
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
                  onClick={() => setState('setup')}
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
        </div>

        {/* Blacklist toast */}
        {blacklistToast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-200 dark:text-zinc-900">
            Sentence hidden
          </div>
        )}

      </main>
    </div>
  );
}
