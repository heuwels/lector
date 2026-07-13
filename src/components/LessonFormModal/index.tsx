'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { LessonFormModalProps } from './types';

export default function LessonFormModal({
  isOpen,
  mode,
  initial,
  onClose,
  onSave,
}: LessonFormModalProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [textContent, setTextContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on open/close */
  useEffect(() => {
    if (isOpen) {
      setTitle(initial?.title ?? '');
      setTextContent(initial?.textContent ?? '');
      setIsSaving(false);
    }
  }, [isOpen, initial]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const wordCount = textContent.trim() ? textContent.trim().split(/\s+/).length : 0;

  const handleSave = useCallback(async () => {
    if (!title.trim() || !textContent.trim()) return;
    setIsSaving(true);
    try {
      await onSave({ title: title.trim(), textContent: textContent.trim() });
      onClose();
    } catch {
      setIsSaving(false);
    }
  }, [title, textContent, onSave, onClose]);

  const heading = mode === 'create' ? 'Add lesson' : 'Edit lesson';
  const submitLabel = mode === 'create' ? 'Create lesson' : 'Save changes';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        initialFocus={titleRef}
        className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <DialogTitle>{heading}</DialogTitle>
          <DialogClose
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </DialogClose>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div>
            <label
              htmlFor="lesson-title"
              className="mb-2 block text-sm font-medium text-foreground"
            >
              Title
            </label>
            <input
              ref={titleRef}
              id="lesson-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSaving}
              placeholder="Lesson title"
              className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                htmlFor="lesson-content"
                className="block text-sm font-medium text-foreground"
              >
                Text
              </label>
              {wordCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {wordCount.toLocaleString()} words
                </span>
              )}
            </div>
            <textarea
              id="lesson-content"
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              disabled={isSaving}
              placeholder="Lesson text. Markdown is supported."
              rows={12}
              className="w-full resize-none rounded-lg border border-input bg-background px-4 py-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border bg-muted px-6 py-4">
          <DialogClose className={buttonVariants({ variant: 'ghost' })} disabled={isSaving}>
            Cancel
          </DialogClose>
          <Button
            onClick={handleSave}
            disabled={isSaving || !title.trim() || !textContent.trim()}
          >
            {isSaving ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                Saving...
              </div>
            ) : (
              submitLabel
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
