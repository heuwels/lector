'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import PreviewStep from './components/PreviewStep';
import UrlInputStep from './components/UrlInputStep';
import type { ModalState, WebImportModalProps } from './types';
import { extractArticle } from './utils';

export default function WebImportModal({ isOpen, onClose, onSave }: WebImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ModalState>({ phase: 'input' });
  const [editedTitle, setEditedTitle] = useState('');
  const [editedAuthor, setEditedAuthor] = useState('');

  // Reset state when modal opens
  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on open/close */
  useEffect(() => {
    if (isOpen) {
      setUrl('');
      setState({ phase: 'input' });
      setEditedTitle('');
      setEditedAuthor('');
    }
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleExtract = useCallback(async () => {
    if (!url.trim()) return;

    setState({ phase: 'loading' });

    const result = await extractArticle(url.trim());

    if (!result.ok) {
      setState({ phase: 'error', message: result.message });
      return;
    }

    setEditedTitle(result.data.title);
    setEditedAuthor(result.data.author || result.data.siteName || 'Unknown');
    setState({ phase: 'preview', data: result.data });
  }, [url]);

  const handleSave = useCallback(async () => {
    if (state.phase !== 'preview') return;

    setState({ phase: 'saving' });

    try {
      await onSave({
        title: editedTitle,
        author: editedAuthor,
        content: state.data.content,
      });
      onClose();
    } catch (error) {
      console.error('Error saving article:', error);
      setState({ phase: 'error', message: 'Failed to save article.' });
    }
  }, [state, editedTitle, editedAuthor, onSave, onClose]);

  const handleKeyPress = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && state.phase === 'input') {
        handleExtract();
      }
    },
    [state.phase, handleExtract],
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        initialFocus={inputRef}
        className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <DialogTitle>Import from Web</DialogTitle>
          <DialogClose className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label="Close">
            <X size="20" />
          </DialogClose>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {(state.phase === 'input' || state.phase === 'loading' || state.phase === 'error') && (
            <UrlInputStep
              url={url}
              onUrlChange={setUrl}
              onKeyDown={handleKeyPress}
              onExtract={handleExtract}
              isLoading={state.phase === 'loading'}
              errorMessage={state.phase === 'error' ? state.message : null}
              onRetry={() => setState({ phase: 'input' })}
              inputRef={inputRef}
            />
          )}

          {(state.phase === 'preview' || state.phase === 'saving') && (
            <PreviewStep
              title={editedTitle}
              author={editedAuthor}
              onTitleChange={setEditedTitle}
              onAuthorChange={setEditedAuthor}
              isSaving={state.phase === 'saving'}
              article={state.phase === 'preview' ? state.data : null}
            />
          )}
        </div>

        {/* Footer */}
        {(state.phase === 'preview' || state.phase === 'saving') && (
          <div className="flex items-center justify-end gap-3 border-t border-border bg-muted px-6 py-4">
            <Button
              variant="ghost"
              onClick={() => setState({ phase: 'input' })}
              disabled={state.phase === 'saving'}
            >
              Back
            </Button>
            <Button
              onClick={handleSave}
              disabled={state.phase === 'saving' || !editedTitle.trim()}
            >
              {state.phase === 'saving' ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  Saving...
                </div>
              ) : (
                'Save to Library'
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
