import { Trash2 } from 'lucide-react';
import { JournalEntry } from '@/lib/data-layer';
import { formatDateTime } from '../utils';

export default function HistoryCard({
  entry,
  onSelect,
  onDelete,
}: {
  entry: JournalEntry;
  onSelect: (e: JournalEntry) => void;
  onDelete: (id: string) => void;
}) {
  const preview = entry.body.length > 120 ? entry.body.slice(0, 120) + '…' : entry.body;
  const correctionCount = entry.corrections?.length ?? 0;

  return (
    <div
      onClick={() => onSelect(entry)}
      className="cursor-pointer rounded-lg border border-border p-4 transition-colors hover:bg-accent"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {formatDateTime(entry.createdAt)}
        </span>
        <div className="flex items-center gap-2">
          {entry.status === 'submitted' ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] px-2 py-0.5 text-xs font-medium text-primary">
              {correctionCount > 0
                ? `${correctionCount} correction${correctionCount !== 1 ? 's' : ''}`
                : 'Perfect'}
            </span>
          ) : (
            <span className="rounded-full bg-[var(--gold-soft)] px-2 py-0.5 text-xs font-medium text-[var(--gold-strong)]">
              Draft
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(entry.id);
            }}
            className="text-muted-foreground transition-colors hover:text-destructive"
            title="Delete entry"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground">{preview}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {entry.wordCount} word{entry.wordCount > 1 ? 's' : ''}
      </p>
    </div>
  );
}
