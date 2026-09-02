import { BookOpenText, Brain, Highlighter, LucideIcon, MousePointer2 } from 'lucide-react';
import { OnboardingCoachStage } from './types';

export function getContent({
  stage,
  savedCount,
}: {
  stage: OnboardingCoachStage;
  savedCount: number;
}): { icon: LucideIcon; eyebrow: string; title: string; body: string } {
  switch (stage) {
    case 'lookup':
      return {
        icon: MousePointer2,
        eyebrow: 'Try the reader',
        title: 'Choose any highlighted word',
        body: 'Coloured words are still new to you. Tap or click one to see its meaning here in the lesson.',
      };
    case 'save':
      return {
        icon: BookOpenText,
        eyebrow: `${Math.min(savedCount, 3)} of 3 ready`,
        title: savedCount === 0 ? 'Add this word to your review' : 'Choose another useful word',
        body:
          savedCount === 0
            ? 'Choose level 1-4 in the definition panel. You will see this word fill the review progress below.'
            : 'Close the definition, choose a different highlighted word, then set its level to add it.',
      };
    case 'phrase':
      return {
        icon: Highlighter,
        eyebrow: `${Math.min(savedCount, 3)} of 3 ready`,
        title: 'Now translate a whole phrase',
        body: 'Close the definition, then drag across two or more words (or long-press on mobile). Release to translate the highlighted phrase.',
      };
    case 'practice':
    default:
      return {
        icon: Brain,
        eyebrow: 'Your mini-review is ready',
        title: 'Practise the words you just read',
        body: 'Three quick cards will close the loop while the lesson is still fresh.',
      };
  }
}
