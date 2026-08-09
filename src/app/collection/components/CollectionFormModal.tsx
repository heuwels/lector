'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';

export interface CollectionFormData {
  title: string;
  author: string;
}

interface CollectionFormModalProps {
  isOpen: boolean;
  initial?: CollectionFormData | null;
  onClose: () => void;
  onSave: (data: CollectionFormData) => Promise<void>;
}

export default function CollectionFormModal({
  isOpen,
  initial,
  onClose,
  onSave,
}: CollectionFormModalProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on open/close */
  useEffect(() => {
    if (isOpen) {
      setTitle(initial?.title ?? '');
      setAuthor(initial?.author ?? '');
      setIsSaving(false);
    }
  }, [isOpen, initial]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // A real <form> so Enter in either field submits, which is what a two-field
  // dialog should do. Both fields are single-line, so nothing else wants Enter.
  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!title.trim() || !author.trim() || isSaving) return;
      setIsSaving(true);
      try {
        await onSave({ title: title.trim(), author: author.trim() });
        onClose();
      } catch {
        setIsSaving(false);
      }
    },
    [title, author, isSaving, onSave, onClose],
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent initialFocus={titleRef} className="max-w-lg overflow-hidden">
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <DialogTitle>Edit collection</DialogTitle>
            <DialogClose
              type="button"
              className={buttonVariants({ variant: 'ghost', size: 'icon' })}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </DialogClose>
          </div>

          <div className="space-y-4 p-6">
            <div>
              <label
                htmlFor="collection-title"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Title
              </label>
              <input
                ref={titleRef}
                id="collection-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isSaving}
                placeholder="Collection title"
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50"
              />
            </div>

            <div>
              <label
                htmlFor="collection-author"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Author
              </label>
              <input
                id="collection-author"
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                disabled={isSaving}
                placeholder="Author"
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border bg-muted px-6 py-4">
            <DialogClose
              type="button"
              className={buttonVariants({ variant: 'ghost' })}
              disabled={isSaving}
            >
              Cancel
            </DialogClose>
            <Button type="submit" disabled={isSaving || !title.trim() || !author.trim()}>
              {isSaving ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                  Saving...
                </div>
              ) : (
                'Save changes'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
