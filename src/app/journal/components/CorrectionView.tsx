import { JournalEntry } from '@/lib/data-layer';
import CorrectionBadge from './CorrectionBadge';
import HighlightedText from './HighlightedText';

export default function CorrectionView({ entry }: { entry: JournalEntry }) {
  const corrections = entry.corrections ?? [];

  return (
    <div className="space-y-6 px-5 py-4">
      <div>
        <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Your text
        </h3>
        <div className="font-reading text-base leading-8 whitespace-pre-wrap">
          <HighlightedText body={entry.body} corrections={corrections} />
        </div>
        {corrections.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Tap a marked word to see the fix.</p>
        )}
      </div>

      {entry.correctedBody && entry.correctedBody !== entry.body && (
        <div>
          <h3 className="mb-1 text-xs font-medium tracking-wide text-primary uppercase">
            Corrected
          </h3>
          <div className="font-reading text-base leading-8 whitespace-pre-wrap text-foreground">
            {entry.correctedBody}
          </div>
        </div>
      )}

      {corrections.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {corrections.length} correction{corrections.length === 1 ? '' : 's'}:
          </span>
          {corrections.map((correction, index) => (
            <CorrectionBadge key={index} type={correction.type} />
          ))}
        </div>
      ) : (
        <p className="font-reading text-base leading-8 text-primary">Perfect. No corrections.</p>
      )}
    </div>
  );
}
