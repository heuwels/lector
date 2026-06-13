'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { LessonFormModalProps } from './types';

export default function LessonFormModal({
  isOpen,
  mode,
  initial,
  onClose,
  onSave,
}: LessonFormModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [textContent, setTextContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on open/close */
  useEffect(() => {
    if (isOpen) {
      setTitle(initial?.title ?? '');
      setTextContent(initial?.textContent ?? '');
      setIsSaving(false);
      requestAnimationFrame(() => setIsVisible(true));
      setTimeout(() => titleRef.current?.focus(), 100);
    } else {
      setIsVisible(false);
    }
  }, [isOpen, initial]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  if (!isOpen || typeof window === 'undefined') return null;

  const heading = mode === 'create' ? 'Add lesson' : 'Edit lesson';
  const submitLabel = mode === 'create' ? 'Create lesson' : 'Save changes';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        ref={modalRef}
        className={`flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl transition-all duration-200 ease-out dark:border-zinc-700 dark:bg-zinc-900 ${isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{heading}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div>
            <label
              htmlFor="lesson-title"
              className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
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
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-900 placeholder-zinc-400 focus:ring-2 focus:ring-zinc-900 focus:outline-none disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:ring-zinc-100"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                htmlFor="lesson-content"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Text
              </label>
              {wordCount > 0 && (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
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
              className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm leading-relaxed text-zinc-900 placeholder-zinc-400 focus:ring-2 focus:ring-zinc-900 focus:outline-none disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:ring-zinc-100"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-700 dark:bg-zinc-800/50">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg px-4 py-2 font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !title.trim() || !textContent.trim()}
            className="rounded-lg bg-zinc-900 px-5 py-2 font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isSaving ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white dark:border-zinc-900/30 dark:border-t-zinc-900" />
                Saving...
              </div>
            ) : (
              submitLabel
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
