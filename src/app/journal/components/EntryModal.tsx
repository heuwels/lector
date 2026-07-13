import { X } from 'lucide-react';
import { JournalEntry } from '@/lib/data-layer';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto rounded-xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle>
            {formatDateTime(entry.createdAt)}
          </DialogTitle>
          <DialogClose
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </DialogClose>
        </div>
        {entry.status === 'submitted' ? (
          <CorrectionView entry={entry} />
        ) : (
          <div className="rounded-lg bg-muted p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {entry.body}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
