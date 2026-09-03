import { Trash2 } from 'lucide-react';
import type { JournalEntry } from '@/lib/data-layer';
import { formatDate } from '../utils';
import StatusBadge from './StatusBadge';

export default function EntrySidebar({
  entries,
  activeId,
  composing,
  onSelect,
  onDelete,
}: {
  entries: JournalEntry[];
  activeId: string | null;
  composing: boolean;
  onSelect: (entry: JournalEntry) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-2 md:w-56">
      <h2 className="px-1 text-sm font-medium text-muted-foreground">Past entries</h2>
      <div className="flex gap-2 overflow-x-auto pb-1 md:max-h-[36rem] md:flex-col md:overflow-y-auto">
        {composing && (
          <div className="min-w-[10rem] rounded-xl border border-primary bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))] px-3 py-2 text-sm text-primary md:min-w-0">
            New page
          </div>
        )}
        {entries.map((entry) => {
          const active = !composing && entry.id === activeId;
          const preview = entry.body.length > 72 ? `${entry.body.slice(0, 72)}…` : entry.body;
          return (
            <div
              key={entry.id}
              className={`min-w-[12rem] rounded-xl border px-3 py-2 md:min-w-0 ${
                active
                  ? 'border-primary bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))]'
                  : 'border-border bg-card hover:bg-accent'
              }`}
            >
              <button type="button" onClick={() => onSelect(entry)} className="w-full text-left">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {formatDate(entry.entryDate)}
                  </span>
                  <StatusBadge entry={entry} />
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {preview || 'Empty page'}
                </p>
              </button>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {entry.wordCount} word{entry.wordCount === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(entry.id)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  title="Delete entry"
                  aria-label="Delete entry"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
