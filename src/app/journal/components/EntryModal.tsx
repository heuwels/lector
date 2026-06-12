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
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {formatDateTime(entry.createdAt)}
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        {entry.status === 'submitted' ? (
          <CorrectionView entry={entry} />
        ) : (
          <div className="rounded-lg bg-zinc-50 p-4 text-sm leading-relaxed whitespace-pre-wrap dark:bg-zinc-800">
            {entry.body}
          </div>
        )}
      </div>
    </div>
  );
}
