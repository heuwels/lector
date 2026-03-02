'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import NavHeader from '@/components/NavHeader';
// ClozeInput component no longer used - inline input in sentence
import ClozeFeedback from '@/components/ClozeFeedback';
import {
  db,
  ClozeSentence,
  ClozeMasteryLevel,
  ClozeCollection,
  getClozeSentencesDueForReview,
  getClozeSentencesByCollection,
  getNewSentencesByCollection,
  getCollectionCounts,
  saveClozeSentence,
  updateClozeAfterReview,
  getTodayStats,
  incrementDailyStat,
  bulkSaveClozeSentences,
  migrateClozeSentences,
} from '@/lib/db';
import { fetchAfrikaansSentences, fetchBulkSentences, TatoebaSentence, findBestClozeWord, getCollectionForRank, ProcessedSentence } from '@/lib/tatoeba';
import { speak, isTTSAvailable } from '@/lib/tts';
import { addClozeCard, isAnkiConnected } from '@/lib/anki';

// Constants
const DAILY_GOAL = 50;
const ANKI_DECK_NAME = 'Afrikaans::Cloze';

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

  // Check if input is a prefix of the correct word (on track)
  if (correct.startsWith(input)) return 'partial';

  // Check if correct word starts with the input (typo tolerance)
  // Also check if they share a common prefix of at least 2 chars
  const commonPrefixLength = [...input].findIndex((char, i) => correct[i] !== char);
  if (commonPrefixLength === -1) return 'partial'; // input is prefix
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

type PracticeState = 'loading' | 'practicing' | 'feedback' | 'complete';

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
  const [state, setState] = useState<PracticeState>('loading');
  const [queue, setQueue] = useState<ClozeSentence[]>([]);
  const [current, setCurrent] = useState<CurrentSentence | null>(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [todayCount, setTodayCount] = useState(0);
  const [points, setPoints] = useState(0);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [ankiConnected, setAnkiConnected] = useState(false);

  // Collection state
  const [selectedCollection, setSelectedCollection] = useState<ClozeCollection>('top500');
  const [collectionCounts, setCollectionCounts] = useState<Record<ClozeCollection, { total: number; due: number; mastered: number }> | null>(null);
  const [recentWords, setRecentWords] = useState<string[]>([]);
  const [isFetchingBulk, setIsFetchingBulk] = useState(false);
  const [fetchProgress, setFetchProgress] = useState({ current: 0, total: 0 });

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
  const [hintLetters, setHintLetters] = useState(0); // Number of hint letters shown
  const [showingAnswer, setShowingAnswer] = useState(false); // Showing answer before retry
  const [retryQueue, setRetryQueue] = useState<ClozeSentence[]>([]); // Sentences to retry

  const inputRef = useRef<HTMLInputElement>(null);

  // Load collection counts
  const refreshCollectionCounts = useCallback(async () => {
    const counts = await getCollectionCounts();
    setCollectionCounts(counts);
  }, []);

  // Initialize - load due sentences and today's stats
  useEffect(() => {
    const initialize = async () => {
      try {
        // Check TTS support
        setTtsSupported(isTTSAvailable());

        // Check Anki connection
        const connected = await isAnkiConnected();
        setAnkiConnected(connected);

        // Get today's stats
        const stats = await getTodayStats();
        setTodayCount(stats.clozePracticed);
        setPoints(stats.points);

        // Migrate existing sentences to have collections
        const migrated = await migrateClozeSentences();
        if (migrated > 0) {
          console.log(`Migrated ${migrated} cloze sentences to collections`);
        }

        // Load collection counts
        await refreshCollectionCounts();

        // Load due sentences from selected collection
        const dueSentences = await getClozeSentencesByCollection(selectedCollection, DAILY_GOAL, recentWords);

        if (dueSentences.length > 0) {
          setQueue(dueSentences);
          loadNextSentence(dueSentences);
        } else {
          // No due sentences, try new sentences or fetch from Tatoeba
          const newSentences = await getNewSentencesByCollection(selectedCollection, DAILY_GOAL, recentWords);
          if (newSentences.length > 0) {
            setQueue(newSentences);
            loadNextSentence(newSentences);
          } else {
            await fetchNewSentences();
          }
        }
      } catch (error) {
        console.error('Failed to initialize practice:', error);
        setState('complete');
      }
    };

    initialize();
  }, [selectedCollection, refreshCollectionCounts]);

  // Fetch new sentences from Tatoeba
  const fetchNewSentences = async () => {
    try {
      const tatoebaSentences = await fetchAfrikaansSentences(20);
      const validSentences = tatoebaSentences.filter(
        (s): s is TatoebaSentence & { translation: NonNullable<TatoebaSentence['translation']> } =>
          s.translation !== undefined && s.text.split(/\s+/).length >= 3
      );

      if (validSentences.length === 0) {
        setState('complete');
        return;
      }

      // Convert to ClozeSentence and save to DB
      const newSentences: ClozeSentence[] = [];
      for (const s of validSentences) {
        const { word, index, rank } = findBestClozeWord(s.text);
        const collection = getCollectionForRank(rank);

        // Check if this sentence already exists
        const existing = await db.clozeSentences
          .where('tatoebaSentenceId')
          .equals(s.id)
          .first();

        if (!existing) {
          const clozeSentence: ClozeSentence = {
            id: uuidv4(),
            sentence: s.text,
            clozeWord: word,
            clozeIndex: index,
            translation: s.translation.text,
            source: 'tatoeba',
            collection,
            wordRank: rank,
            tatoebaSentenceId: s.id,
            masteryLevel: 0,
            nextReview: new Date(),
            reviewCount: 0,
            timesCorrect: 0,
            timesIncorrect: 0,
          };

          await saveClozeSentence(clozeSentence);
          newSentences.push(clozeSentence);
        }
      }

      if (newSentences.length > 0) {
        setQueue(newSentences);
        loadNextSentence(newSentences);
      } else {
        // All sentences were duplicates, try to get due ones again
        const dueSentences = await getClozeSentencesDueForReview(DAILY_GOAL);
        if (dueSentences.length > 0) {
          setQueue(dueSentences);
          loadNextSentence(dueSentences);
        } else {
          setState('complete');
        }
      }
    } catch (error) {
      console.error('Failed to fetch sentences:', error);
      setState('complete');
    }
  };

  // Bulk fetch sentences from Tatoeba (pre-populate database)
  const handleBulkFetch = async () => {
    setIsFetchingBulk(true);
    setFetchProgress({ current: 0, total: 10 });

    try {
      const processedSentences = await fetchBulkSentences(10, (current, total) => {
        setFetchProgress({ current, total });
      });

      // Convert to ClozeSentence objects
      const clozeSentences: ClozeSentence[] = [];
      for (const s of processedSentences) {
        if (!s.translation) continue;

        // Check if already exists
        const existing = await db.clozeSentences
          .where('tatoebaSentenceId')
          .equals(s.id)
          .first();

        if (!existing) {
          clozeSentences.push({
            id: uuidv4(),
            sentence: s.text,
            clozeWord: s.clozeWord,
            clozeIndex: s.clozeIndex,
            translation: s.translation.text,
            source: 'tatoeba',
            collection: s.collection,
            wordRank: s.wordRank,
            tatoebaSentenceId: s.id,
            masteryLevel: 0,
            nextReview: new Date(),
            reviewCount: 0,
            timesCorrect: 0,
            timesIncorrect: 0,
          });
        }
      }

      if (clozeSentences.length > 0) {
        await bulkSaveClozeSentences(clozeSentences);
      }

      await refreshCollectionCounts();
      alert(`Fetched ${clozeSentences.length} new sentences!`);
    } catch (error) {
      console.error('Bulk fetch failed:', error);
      alert('Failed to fetch sentences. Check console for details.');
    } finally {
      setIsFetchingBulk(false);
    }
  };

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
    await incrementDailyStat('clozePracticed');
    if (earnedPoints > 0) {
      await incrementDailyStat('points', earnedPoints);
    }

    // Update local state
    setTodayCount((prev) => prev + 1);
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
    } else if (todayCount < DAILY_GOAL) {
      // Try to fetch more sentences
      setState('loading');
      await fetchNewSentences();
    } else {
      setState('complete');
    }
  }, [current, queue, retryQueue, todayCount, loadNextSentence, fetchNewSentences]);

  // Handle Enter key in feedback state to go to next sentence
  useEffect(() => {
    if (state !== 'feedback') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, handleNext]);

  // Handle add to Anki
  const handleAddToAnki = async () => {
    if (!current || !feedbackData || !feedbackData.isCorrect || isAddingToAnki || ankiAdded) return;

    setIsAddingToAnki(true);
    try {
      await addClozeCard(
        ANKI_DECK_NAME,
        current.sentence.sentence,
        current.sentence.clozeWord,
        current.sentence.translation,
        current.sentence.clozeWord // Word meaning could be enhanced with translation
      );
      setAnkiAdded(true);
    } catch (error) {
      console.error('Failed to add to Anki:', error);
      // Could add toast notification here
    } finally {
      setIsAddingToAnki(false);
    }
  };

  // Handle TTS
  const handleSpeak = () => {
    if (!current) return;
    speak(current.sentence.sentence);
  };

  // Progress percentage
  const progressPercent = Math.min((todayCount / DAILY_GOAL) * 100, 100);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <NavHeader />

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header with progress */}
        <div className="mb-8">
          <div className="mb-2 flex items-center justify-between">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Cloze Practice</h1>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                {points.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-2">
            <div className="flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
              <span>Daily Progress</span>
              <span className="font-medium">{todayCount}/{DAILY_GOAL} sentences</span>
            </div>
            <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {todayCount >= DAILY_GOAL && (
            <p className="mt-2 text-sm font-medium text-green-600 dark:text-green-400">
              Daily goal reached! Keep going for bonus practice.
            </p>
          )}

          {/* Collection selector */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(['top500', 'top1000', 'top2000', 'mined', 'random'] as ClozeCollection[]).map((coll) => {
              const count = collectionCounts?.[coll];
              return (
                <button
                  key={coll}
                  onClick={() => setSelectedCollection(coll)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedCollection === coll
                      ? 'bg-blue-500 text-white'
                      : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  {COLLECTION_LABELS[coll]}
                  {count && (
                    <span className="ml-1.5 text-xs opacity-75">
                      ({count.due}/{count.total})
                    </span>
                  )}
                </button>
              );
            })}
            <button
              onClick={handleBulkFetch}
              disabled={isFetchingBulk}
              className="ml-auto rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            >
              {isFetchingBulk ? `Fetching ${fetchProgress.current}/${fetchProgress.total}...` : 'Fetch More'}
            </button>
          </div>
        </div>

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
                  <div className="mb-4">
                    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                      Fill in the blank
                    </span>
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
                Practice Complete!
              </h2>
              <p className="mb-4 text-zinc-500 dark:text-zinc-400">
                You reviewed {todayCount} sentences today and earned {points.toLocaleString()} points.
              </p>
              <button
                type="button"
                onClick={() => {
                  setState('loading');
                  fetchNewSentences();
                }}
                className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-all hover:bg-blue-700 active:scale-95 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                Load More Sentences
              </button>
            </div>
          )}
        </div>

        {/* Tips section */}
        {state === 'practicing' && (
          <div className="mt-6 rounded-xl border border-zinc-200 bg-white/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
            <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Tips</h3>
            <ul className="space-y-1 text-sm text-zinc-500 dark:text-zinc-400">
              <li>- Type the missing Afrikaans word to complete the sentence</li>
              <li>- Press Enter or click Check to submit your answer</li>
              <li>- Correct answers increase mastery: 0% -&gt; 25% -&gt; 50% -&gt; 75% -&gt; 100%</li>
              <li>- Incorrect answers reset mastery to 0%</li>
              {ankiConnected && <li>- Add sentences to Anki for additional spaced repetition</li>}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
