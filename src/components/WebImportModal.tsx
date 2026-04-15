'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ExtractedArticle } from '@/app/api/extract-url/route';

interface WebImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (article: { title: string; author: string; content: string }) => Promise<void>;
}

type ModalState =
  | { phase: 'input' }
  | { phase: 'loading' }
  | { phase: 'preview'; data: ExtractedArticle }
  | { phase: 'saving' }
  | { phase: 'error'; message: string };

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

    try {
      const response = await fetch('/api/extract-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setState({ phase: 'error', message: data.error || 'Failed to extract article' });
        return;
      }

      setEditedTitle(data.title);
      setEditedAuthor(data.author || data.siteName || 'Unknown');
      setState({ phase: 'preview', data });
    } catch (error) {
      console.error('Error extracting URL:', error);
      setState({ phase: 'error', message: 'Network error. Check your connection.' });
    }
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
    [state.phase, handleExtract]
  );

  if (!isOpen) return null;
  if (typeof window === 'undefined') return null;

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className={`
          w-full max-w-2xl max-h-[85vh]
          bg-white dark:bg-zinc-900
          rounded-2xl shadow-2xl
          border border-zinc-200 dark:border-zinc-700
          overflow-hidden flex flex-col
          transition-all duration-200 ease-out
          ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Import from Web
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* URL Input */}
          {(state.phase === 'input' || state.phase === 'loading' || state.phase === 'error') && (
            <div className="space-y-4">
              <div>
                <label htmlFor="url-input" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  Article URL
                </label>
                <div className="flex gap-3">
                  <input
                    ref={inputRef}
                    id="url-input"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="https://www.netwerk24.com/..."
                    disabled={state.phase === 'loading'}
                    className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50"
                  />
                  <button
                    onClick={handleExtract}
                    disabled={!url.trim() || state.phase === 'loading'}
                    className="px-5 py-2.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {state.phase === 'loading' ? (
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white dark:border-zinc-900/30 dark:border-t-zinc-900 rounded-full animate-spin" />
                        Extracting...
                      </div>
                    ) : (
                      'Extract'
                    )}
                  </button>
                </div>
              </div>

              {state.phase === 'error' && (
                <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <p className="text-sm text-red-700 dark:text-red-300">{state.message}</p>
                  <button
                    onClick={() => setState({ phase: 'input' })}
                    className="mt-2 text-sm font-medium text-red-600 dark:text-red-400 hover:underline"
                  >
                    Try again
                  </button>
                </div>
              )}

              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Paste a URL to an Afrikaans news article or blog post. The article content will be extracted and added to your library.
              </p>
            </div>
          )}

          {/* Preview */}
          {(state.phase === 'preview' || state.phase === 'saving') && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="title-input" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Title
                  </label>
                  <input
                    id="title-input"
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    disabled={state.phase === 'saving'}
                    className="w-full px-4 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label htmlFor="author-input" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Author / Source
                  </label>
                  <input
                    id="author-input"
                    type="text"
                    value={editedAuthor}
                    onChange={(e) => setEditedAuthor(e.target.value)}
                    disabled={state.phase === 'saving'}
                    className="w-full px-4 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50"
                  />
                </div>
              </div>

              {state.phase === 'preview' && (
                <div className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
                  <span>{state.data.wordCount.toLocaleString()} words</span>
                  {state.data.siteName && <span>from {state.data.siteName}</span>}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  Content Preview
                </label>
                <div className="h-64 overflow-y-auto p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                  {state.phase === 'preview' && state.data.content}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {(state.phase === 'preview' || state.phase === 'saving') && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
            <button
              onClick={() => setState({ phase: 'input' })}
              disabled={state.phase === 'saving'}
              className="px-4 py-2 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 font-medium transition-colors disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={handleSave}
              disabled={state.phase === 'saving' || !editedTitle.trim()}
              className="px-5 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {state.phase === 'saving' ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white dark:border-zinc-900/30 dark:border-t-zinc-900 rounded-full animate-spin" />
                  Saving...
                </div>
              ) : (
                'Save to Library'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
