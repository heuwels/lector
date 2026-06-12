import { JournalEntry } from '@/lib/data-layer';
import CorrectionBadge from './CorrectionBadge';
import HighlightedText from './HighlightedText';

export default function CorrectionView({ entry }: { entry: JournalEntry }) {
  const corrections = entry.corrections || [];

  return (
    <div className="space-y-6">
      {/* Original with inline highlights */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">Your text</h3>
        <div className="rounded-lg bg-zinc-50 p-4 text-sm leading-relaxed whitespace-pre-wrap dark:bg-zinc-900">
          <HighlightedText body={entry.body} corrections={corrections} />
        </div>
        {corrections.length > 0 && (
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Click highlighted words to see corrections
          </p>
        )}
      </div>

      {/* Corrected version */}
      {entry.correctedBody && entry.correctedBody !== entry.body && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">Corrected</h3>
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm leading-relaxed whitespace-pre-wrap dark:border-green-900 dark:bg-green-950/30">
            {entry.correctedBody}
          </div>
        </div>
      )}

      {/* Summary */}
      {corrections.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {corrections.length} correction{corrections.length !== 1 ? 's' : ''}:
          </span>
          {corrections.map((c, i) => (
            <CorrectionBadge key={i} type={c.type} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center dark:border-green-900 dark:bg-green-950/30">
          <p className="font-medium text-green-800 dark:text-green-300">
            Perfek! No corrections needed.
          </p>
        </div>
      )}
    </div>
  );
}
