'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useActiveLanguage } from '@/utils/hooks';
import type { PasteImportModalProps } from './types';

export default function PasteImportModal({ isOpen, onClose, onSave }: PasteImportModalProps) {
  const activeLang = useActiveLanguage();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on open/close */
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setAuthor('');
      setContent('');
      setIsSaving(false);
    }
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  const handleSave = useCallback(async () => {
    if (!title.trim() || !content.trim()) return;
    setIsSaving(true);
    try {
      await onSave({
        title: title.trim(),
        author: author.trim() || 'Unknown',
        content: content.trim(),
      });
      onClose();
    } catch {
      setIsSaving(false);
    }
  }, [title, author, content, onSave, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        initialFocus={titleRef}
        className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <DialogTitle>Paste Text</DialogTitle>
          <DialogClose className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label="Close">
            <X className="h-5 w-5" />
          </DialogClose>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="paste-title"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Title
              </label>
              <input
                ref={titleRef}
                id="paste-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isSaving}
                placeholder="Article or text title"
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label
                htmlFor="paste-author"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Author / Source
              </label>
              <input
                id="paste-author"
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                disabled={isSaving}
                placeholder="Optional"
                className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                htmlFor="paste-content"
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
              id="paste-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={isSaving}
              placeholder={`Paste your ${activeLang.native} text here...`}
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
            disabled={isSaving || !title.trim() || !content.trim()}
          >
            {isSaving ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                Saving...
              </div>
            ) : (
              'Save to Library'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
