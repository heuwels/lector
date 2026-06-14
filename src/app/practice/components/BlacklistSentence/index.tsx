import { Button } from '@/components/ui/button';
import { Ban } from 'lucide-react';
import { CurrentSentence } from '../../types';
import { blacklistClozeSentence, unblacklistClozeSentence } from '@/lib/data-layer';
import { toast } from 'sonner';
import { useCallback, useState } from 'react';

export default function BlacklistSentence({
  current,
  onSentenceBlacklisted,
}: {
  current: CurrentSentence | null;
  onSentenceBlacklisted: () => void;
}) {
  const [pendingBlacklist, setPendingBlacklist] = useState<string | null>(null);

  const handleUndoBlacklist = useCallback(async () => {
    try {
      if (pendingBlacklist) {
        await unblacklistClozeSentence(pendingBlacklist);
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to undo blacklist', {
        duration: 2000,
      });
    } finally {
      setPendingBlacklist(null);
    }
  }, [pendingBlacklist]);

  const clearPendingBlacklist = () => {
    setPendingBlacklist(null);
  };

  const handleBlacklist = useCallback(async () => {
    if (!current) return;

    setPendingBlacklist(current.sentence.id);
    await blacklistClozeSentence(current.sentence.id);

    toast.info('Sentence hidden', {
      duration: 2000,
      action: {
        label: 'Undo',
        onClick: handleUndoBlacklist,
      },
      onDismiss: clearPendingBlacklist,
      onAutoClose: clearPendingBlacklist,
    });

    onSentenceBlacklisted();
  }, [current, handleUndoBlacklist, onSentenceBlacklisted]);

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={handleBlacklist}
      title="Skip &amp; hide this sentence"
    >
      <Ban className="h-4 w-4" />
    </Button>
  );
}
