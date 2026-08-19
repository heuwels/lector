'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { submitCommunityItem } from '@/lib/community';

export default function CommunitySubmitDialog({
  open,
  onClose,
  collectionId,
  title,
  lessonCount,
}: {
  open: boolean;
  onClose: () => void;
  collectionId: string;
  title: string;
  lessonCount: number;
}) {
  const router = useRouter();
  const [description, setDescription] = useState('');
  const [displayName, setDisplayName] = useState('A learner');
  const [attested, setAttested] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit() {
    if (!attested) return;
    setPending(true);
    try {
      await submitCommunityItem(collectionId, true, {
        description,
        displayName,
      });
      toast.success('Submitted for review.');
      onClose();
      router.push('/community?mine=1');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not submit';
      if (message !== 'plan_limit') toast.error(message);
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md p-6" data-testid="community-submit-dialog">
        <DialogTitle>Submit to community</DialogTitle>
        <DialogDescription>
          {title} · {lessonCount} {lessonCount === 1 ? 'lesson' : 'lessons'}
        </DialogDescription>
        <label className="mt-4 block text-sm text-foreground">
          Display name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
            data-testid="community-submit-display-name"
          />
        </label>
        <label className="mt-4 block text-sm text-foreground">
          Description (optional)
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
            data-testid="community-submit-description"
          />
        </label>
        <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={attested}
            onChange={(event) => setAttested(event.target.checked)}
            data-testid="community-submit-attest"
            className="mt-1"
          />
          <span>
            I have the right to share this text. I did not copy it from a source that forbids a
            share.
          </span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!attested || pending}
            data-testid="community-submit-confirm"
          >
            {pending ? 'Submit…' : 'Submit'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
