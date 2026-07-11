'use client';

import { BookOpenText, Brain, MousePointer2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type OnboardingCoachStage = 'lookup' | 'save' | 'practice';

interface OnboardingCoachProps {
  stage: OnboardingCoachStage;
  savedCount: number;
  onStartPractice?: () => void;
}

export default function OnboardingCoach({
  stage,
  savedCount,
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
      eyebrow: `${Math.min(savedCount, 3)} of 3 saved`,
      title: savedCount === 0 ? 'Save a useful word' : 'Choose another useful word',
      body: 'In the definition panel, choose levels 1–4 to keep a word for practice. Known and Ignore teach Lector what not to quiz.',
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
