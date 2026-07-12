'use client';

import { BookOpenText, Brain, Check, Highlighter, MousePointer2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type OnboardingCoachStage = 'lookup' | 'phrase' | 'save' | 'practice';

interface OnboardingCoachProps {
  stage: OnboardingCoachStage;
  savedCount: number;
  savedWords: string[];
  onStartPractice?: () => void;
}

export default function OnboardingCoach({
  stage,
  savedCount,
  savedWords,
  onStartPractice,
}: OnboardingCoachProps) {
  const content = {
    lookup: {
      icon: MousePointer2,
      eyebrow: 'Try the reader',
      title: 'Choose any highlighted word',
      body: 'Coloured words are still new to you. Tap or click one to see its meaning here in the lesson.',
    },
    save: {
      icon: BookOpenText,
      eyebrow: `${Math.min(savedCount, 3)} of 3 ready`,
      title: savedCount === 0 ? 'Add this word to your review' : 'Choose another useful word',
      body:
        savedCount === 0
          ? 'Choose level 1–4 in the definition panel. You will see this word fill the review progress below.'
          : 'Close the definition, choose a different highlighted word, then set its level to add it.',
    },
    phrase: {
      icon: Highlighter,
      eyebrow: `${Math.min(savedCount, 3)} of 3 ready`,
      title: 'Now translate a whole phrase',
      body: 'Close the definition, then drag across two or more words (or long-press on mobile). Release to translate the highlighted phrase.',
    },
    practice: {
      icon: Brain,
      eyebrow: 'Your mini-review is ready',
      title: 'Practise the words you just read',
      body: 'Three quick cards will close the loop while the lesson is still fresh.',
    },
  }[stage];
  const Icon = content.icon;

  return (
    <aside
      aria-label="Guided first lesson"
      aria-live="polite"
      data-testid={`onboarding-coach-${stage}`}
      className="fixed right-3 bottom-20 left-3 z-40 rounded-2xl border border-[var(--gold-lip)] bg-card/95 p-4 shadow-xl backdrop-blur-sm sm:right-auto sm:bottom-5 sm:left-[15rem] sm:w-[25rem]"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--gold-soft)] text-[var(--gold-strong)]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold tracking-wide text-[var(--gold-strong)] uppercase">
            {content.eyebrow}
          </p>
          <h2 className="mt-0.5 text-base font-bold text-foreground">{content.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{content.body}</p>
          {(stage === 'save' || stage === 'phrase') && (
            <div className="mt-3" data-testid="onboarding-word-progress">
              <div
                className="grid grid-cols-3 gap-2"
                role="progressbar"
                aria-label={`${Math.min(savedCount, 3)} of 3 review words ready`}
                aria-valuemin={0}
                aria-valuemax={3}
                aria-valuenow={Math.min(savedCount, 3)}
              >
                {[0, 1, 2].map((index) => {
                  const savedWord = savedWords[index];
                  return (
                    <div
                      key={index}
                      className={`flex min-w-0 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-all duration-300 ${
                        savedWord
                          ? 'border-primary/40 bg-[var(--primary-soft)] text-primary'
                          : 'border-border bg-muted/50 text-muted-foreground'
                      }`}
                    >
                      {savedWord ? (
                        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      ) : null}
                      <span className="truncate">{savedWord || `Word ${index + 1}`}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {stage === 'practice' && onStartPractice && (
            <Button
              type="button"
              size="sm"
              onClick={onStartPractice}
              className="mt-3"
              data-testid="start-onboarding-practice"
            >
              Start 3-word practice
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
