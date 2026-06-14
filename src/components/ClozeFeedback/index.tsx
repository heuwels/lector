'use client';

import { AlertTriangle, Check, ChevronRight, Info, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

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
        body: JSON.stringify({
          sentence,
          translation,
          clozeWord: correctWord,
          language: localStorage.getItem('lector-target-language') || 'af',
        }),
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
          ? 'border-primary bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))]'
          : 'border-destructive bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))]'
      }`}
    >
      {/* Result header */}
      <div className="mb-4 flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full ${
            isCorrect
              ? 'bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] text-primary'
              : 'bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] text-destructive'
          }`}
        >
          {isCorrect ? <Check className="h-6 w-6" /> : <X className="h-6 w-6" />}
        </div>
        <div>
          <h3
            className={`text-xl font-bold ${
              isCorrect ? 'text-primary' : 'text-destructive'
            }`}
          >
            {isCorrect ? 'Correct!' : 'Incorrect'}
          </h3>
          {isCorrect && points > 0 && (
            <p className="text-sm font-medium text-[var(--gold-strong)]">
              +{points} points
            </p>
          )}
        </div>
      </div>

      {/* Answer details */}
      <div className="mb-4 space-y-2">
        {!isCorrect && (
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-muted-foreground">Your answer:</span>
            <span className="rounded bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] px-2 py-0.5 font-medium text-destructive line-through">
              {userAnswer}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-muted-foreground">Correct answer:</span>
          <span
            className={`rounded px-2 py-0.5 font-bold ${
              isCorrect
                ? 'bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] text-primary'
                : 'bg-[var(--gold-soft)] text-[var(--gold-strong)]'
            }`}
          >
            {correctWord}
          </span>
        </div>
      </div>

      {/* Translation */}
      <div className="mb-4 rounded-lg bg-muted p-3">
        <p className="text-sm font-medium text-muted-foreground">Translation</p>
        <p className="text-foreground">{translation}</p>
      </div>

      {/* Mastery progress */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">Mastery Level</span>
          <span className="flex items-center gap-2">
            <span
              className={`font-semibold ${
                isCorrect ? 'text-primary' : 'text-destructive'
              }`}
            >
              {masteryLabels[newMastery]}
            </span>
            {masteryChange !== 0 && (
              <span
                className={`text-xs font-bold ${
                  masteryChange > 0 ? 'text-primary' : 'text-destructive'
                }`}
              >
                {masteryChange > 0 ? '+' : ''}
                {masteryChange}%
              </span>
            )}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full transition-all duration-500 ${
              isCorrect ? 'bg-primary' : 'bg-destructive'
            }`}
            style={{ width: `${newMastery}%` }}
          />
        </div>
      </div>

      {/* Explain section */}
      {explanation && (
        <div className="mb-4 rounded-lg bg-muted p-4">
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            Sentence Breakdown
          </p>
          <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
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
                ? 'bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] text-primary'
                : ankiError
                  ? 'bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] text-destructive'
                  : isAddingToAnki
                    ? 'cursor-wait bg-muted text-muted-foreground'
                    : 'bg-[var(--clay-soft)] text-[var(--clay)] hover:bg-[color-mix(in_srgb,var(--clay)_18%,transparent)]'
            }`}
            title={ankiError || undefined}
          >
            {ankiAdded ? (
              <>
                <Check className="h-4 w-4" />
                Added to Anki
              </>
            ) : ankiError ? (
              <>
                <AlertTriangle className="h-4 w-4" />
                Anki Error
              </>
            ) : isAddingToAnki ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
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
              ? 'bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] text-primary'
              : explainError
                ? 'bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] text-destructive'
                : isExplaining
                  ? 'cursor-wait bg-muted text-muted-foreground'
                  : 'bg-[var(--gold-soft)] text-[var(--gold-strong)] hover:bg-[color-mix(in_srgb,var(--gold)_22%,transparent)]'
          }`}
        >
          {explanation ? (
            <>
              <Check className="h-4 w-4" />
              Explained
            </>
          ) : isExplaining ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Explaining...
            </>
          ) : explainError ? (
            <>Explain failed</>
          ) : (
            <>
              <Info className="h-4 w-4" />
              Explain
            </>
          )}
        </button>
        {ankiError && (
          <div className="w-full text-xs text-destructive">{ankiError}</div>
        )}
        <Button type="button" onClick={onNext} className="flex-1">
          Next Sentence
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
