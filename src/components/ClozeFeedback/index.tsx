'use client';

import { Check, ChevronRight, Info, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { ClozeFeedbackProps } from './types';
import { toast } from 'sonner';
import Markdown from 'react-markdown';
import { getActiveLanguage } from '@/lib/data-layer';
import { apiFetch } from '@/lib/api-base';

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
}: ClozeFeedbackProps) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [explainError, setExplainError] = useState(false);

  const handleExplain = async () => {
    if (explanation || isExplaining) return;
    setIsExplaining(true);
    setExplainError(false);

    try {
      const res = await apiFetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentence,
          translation,
          clozeWord: correctWord,
          language: getActiveLanguage(),
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setExplanation(data.explanation);
    } catch {
      toast.error('Failed to fetch explanation');
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
          <h3 className={`text-xl font-bold ${isCorrect ? 'text-primary' : 'text-destructive'}`}>
            {isCorrect ? 'Correct!' : 'Incorrect'}
          </h3>
          {isCorrect && points > 0 && (
            <p className="text-sm font-medium text-[var(--gold-strong)]">+{points} points</p>
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
            <span className={`font-semibold ${isCorrect ? 'text-primary' : 'text-destructive'}`}>
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
        <div className="mb-4 rounded-lg bg-muted p-4 text-sm leading-tight whitespace-pre-wrap text-foreground">
          <div className="">
            <Markdown>{explanation}</Markdown>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        {isCorrect && (
          <Button
            type="button"
            onClick={onAddToAnki}
            disabled={isAddingToAnki || ankiAdded}
            variant="secondary"
            title={ankiAdded ? 'Already added to Anki' : 'Add to Anki'}
          >
            {isAddingToAnki ? (
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
          </Button>
        )}
        <Button
          type="button"
          variant={explainError ? 'destructive' : 'clay'}
          onClick={handleExplain}
          disabled={isExplaining || !!explanation}
        >
          {isExplaining ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Explaining...
            </>
          ) : (
            <>
              <Info className="h-4 w-4" />
              Explain
            </>
          )}
        </Button>
        <Button type="button" onClick={onNext} className="flex-1">
          Next Sentence
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Keyboard hint */}
      <div className="mt-4 flex items-center justify-center text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Enter</Kbd>
          Next sentence
        </span>
      </div>
    </div>
  );
}
