import { Clock } from 'lucide-react';
import type { IEmptyStateProps } from './types';
import { Button } from '@/components/ui/button';

export default function EmptyState({
  onBackPressed,
  onLearnNewPressed,
  roundType,
}: IEmptyStateProps) {
  return (
    <div className="py-8 text-center">
      <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400">
        <Clock className="h-8 w-8" />
      </div>
      <h2 className="mb-2 text-xl font-bold text-zinc-900 dark:text-zinc-50">
        {roundType === 'review' ? 'Nothing to Review' : 'No New Sentences'}
      </h2>
      <p className="mx-auto mb-6 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
        {roundType === 'review'
          ? 'No sentences are due for review right now. Try learning new ones or check back later.'
          : "You've seen all the sentences in this collection. Try a different collection or review existing ones."}
      </p>
      <div className="flex justify-center gap-3">
        <Button variant="secondary" type="button" onClick={onBackPressed}>
          Back
        </Button>
        {roundType === 'review' && (
          <Button type="button" onClick={onLearnNewPressed}>
            Learn New Instead
          </Button>
        )}
      </div>
    </div>
  );
}
