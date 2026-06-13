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
      className="cursor-pointer rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {formatDateTime(entry.createdAt)}
        </span>
        <div className="flex items-center gap-2">
          {entry.status === 'submitted' ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
              {correctionCount > 0
                ? `${correctionCount} correction${correctionCount !== 1 ? 's' : ''}`
                : 'Perfect'}
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              Draft
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(entry.id);
            }}
            className="text-zinc-400 transition-colors hover:text-red-500"
            title="Delete entry"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{preview}</p>
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{entry.wordCount} words</p>
    </div>
  );
}
