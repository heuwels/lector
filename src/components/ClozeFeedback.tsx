'use client';

import { useState } from 'react';

interface ClozeFeedbackProps {
  isCorrect: boolean;
  correctWord: string;
  userAnswer: string;
  translation: string;
  sentence: string;
  points: number;
  newMastery: number;
  previousMastery: number;
  onNext: () => void;
  onAddToAnki: () => void;
  isAddingToAnki?: boolean;
  ankiAdded?: boolean;
  ankiError?: string | null;
}

export default function ClozeFeedback({
  isCorrect,
  correctWord,
  userAnswer,
  translation,
  sentence,
  points,
  newMastery,
  previousMastery,
  onNext,
  onAddToAnki,
  isAddingToAnki = false,
  ankiAdded = false,
  ankiError = null,
}: ClozeFeedbackProps) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [explainError, setExplainError] = useState(false);

  const handleExplain = async () => {
    if (explanation || isExplaining) return;
    setIsExplaining(true);
    setExplainError(false);
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence, translation, clozeWord: correctWord, language: localStorage.getItem('lector-target-language') || 'af' }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setExplanation(data.explanation);
    } catch {
      setExplainError(true);
    } finally {
      setIsExplaining(false);
    }
  };

  const masteryLabels: Record<number, string> = {
    0: 'New',
    25: 'Learning',
    50: 'Familiar',
    75: 'Almost There',
    100: 'Mastered',
  };

  const masteryChange = newMastery - previousMastery;

  return (
    <div
      className={`rounded-xl border-2 p-6 transition-all ${
        isCorrect
          ? 'border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 dark:border-green-800 dark:from-green-950/40 dark:to-emerald-950/40'
          : 'border-red-200 bg-gradient-to-br from-red-50 to-rose-50 dark:border-red-800 dark:from-red-950/40 dark:to-rose-950/40'
      }`}
    >
      {/* Result header */}
      <div className="mb-4 flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full ${
            isCorrect
              ? 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400'
              : 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400'
          }`}
        >
          {isCorrect ? (
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </div>
        <div>
          <h3
            className={`text-xl font-bold ${
              isCorrect ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
            }`}
          >
            {isCorrect ? 'Correct!' : 'Incorrect'}
          </h3>
          {isCorrect && points > 0 && (
            <p className="text-sm font-medium text-green-600 dark:text-green-500">+{points} points</p>
          )}
        </div>
      </div>

      {/* Answer details */}
      <div className="mb-4 space-y-2">
        {!isCorrect && (
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-zinc-500 dark:text-zinc-400">Your answer:</span>
            <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-700 line-through dark:bg-red-900/50 dark:text-red-300">
              {userAnswer}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-zinc-500 dark:text-zinc-400">Correct answer:</span>
          <span
            className={`rounded px-2 py-0.5 font-bold ${
              isCorrect
                ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
            }`}
          >
            {correctWord}
          </span>
        </div>
      </div>

      {/* Translation */}
      <div className="mb-4 rounded-lg bg-white/60 p-3 dark:bg-zinc-900/60">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Translation</p>
        <p className="text-zinc-900 dark:text-zinc-50">{translation}</p>
      </div>

      {/* Mastery progress */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-zinc-500 dark:text-zinc-400">Mastery Level</span>
          <span className="flex items-center gap-2">
            <span
              className={`font-semibold ${
                isCorrect ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
              }`}
            >
              {masteryLabels[newMastery]}
            </span>
            {masteryChange !== 0 && (
              <span
                className={`text-xs font-bold ${
                  masteryChange > 0 ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {masteryChange > 0 ? '+' : ''}{masteryChange}%
              </span>
            )}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
          <div
            className={`h-full transition-all duration-500 ${
              isCorrect
                ? 'bg-gradient-to-r from-green-400 to-emerald-500'
                : 'bg-gradient-to-r from-red-400 to-rose-500'
            }`}
            style={{ width: `${newMastery}%` }}
          />
        </div>
      </div>

      {/* Explain section */}
      {explanation && (
        <div className="mb-4 rounded-lg bg-white/60 p-4 dark:bg-zinc-900/60">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Sentence Breakdown</p>
          <div className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed">
            {explanation}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        {isCorrect && (
          <button
            type="button"
            onClick={onAddToAnki}
            disabled={isAddingToAnki || ankiAdded || !!ankiError}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              ankiAdded
                ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400'
                : ankiError
                ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400'
                : isAddingToAnki
                ? 'bg-zinc-100 text-zinc-400 cursor-wait dark:bg-zinc-800 dark:text-zinc-500'
                : 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/50 dark:text-purple-300 dark:hover:bg-purple-900/70'
            }`}
            title={ankiError || undefined}
          >
            {ankiAdded ? (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Added to Anki
              </>
            ) : ankiError ? (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Anki Error
              </>
            ) : isAddingToAnki ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Adding...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add to Anki
              </>
            )}
          </button>
        )}
        {/* Explain button */}
        <button
          type="button"
          onClick={handleExplain}
          disabled={isExplaining || !!explanation}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
            explanation
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400'
              : explainError
              ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400'
              : isExplaining
              ? 'bg-zinc-100 text-zinc-400 cursor-wait dark:bg-zinc-800 dark:text-zinc-500'
              : 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-900/70'
          }`}
        >
          {explanation ? (
            <>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Explained
            </>
          ) : isExplaining ? (
            <>
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Explaining...
            </>
          ) : explainError ? (
            <>Explain failed</>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Explain
            </>
          )}
        </button>
        {ankiError && (
          <div className="w-full text-xs text-red-600 dark:text-red-400">
            {ankiError}
          </div>
        )}
        <button
          type="button"
          onClick={onNext}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-blue-700 active:scale-95 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          Next Sentence
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
