'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import PreviewStep from './components/PreviewStep';
import UrlInputStep from './components/UrlInputStep';
import type { ModalState, WebImportModalProps } from './types';
import { extractArticle } from './utils';

export default function WebImportModal({ isOpen, onClose, onSave }: WebImportModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ModalState>({ phase: 'input' });
  const [editedTitle, setEditedTitle] = useState('');
  const [editedAuthor, setEditedAuthor] = useState('');
  const [isVisible, setIsVisible] = useState(false);

  // Reset state when modal opens
  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on open/close */
  useEffect(() => {
    if (isOpen) {
      setUrl('');
      setState({ phase: 'input' });
      setEditedTitle('');
      setEditedAuthor('');
      requestAnimationFrame(() => setIsVisible(true));
      // Focus input after animation
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  if (!isOpen) return null;
  if (typeof window === 'undefined') return null;

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        ref={modalRef}
        className={`flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl transition-all duration-200 ease-out ${isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            Import from Web
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X size="20" />
          </Button>
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
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
