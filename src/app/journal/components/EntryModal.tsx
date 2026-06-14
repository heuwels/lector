import { X } from 'lucide-react';
import { JournalEntry } from '@/lib/data-layer';
import { formatDateTime } from '../utils';
import CorrectionView from './CorrectionView';

export default function EntryModal({
  entry,
  onClose,
}: {
  entry: JournalEntry;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {formatDateTime(entry.createdAt)}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {entry.status === 'submitted' ? (
          <CorrectionView entry={entry} />
        ) : (
          <div className="rounded-lg bg-muted p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {entry.body}
          </div>
        )}
      </div>
    </div>
  );
}
