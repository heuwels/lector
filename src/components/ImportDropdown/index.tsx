'use client';

import { useState, useRef, useEffect } from 'react';
import { IMPORT_OPTIONS } from './constants';
import type { ImportDropdownProps, ImportSource } from './types';

export default function ImportDropdown({
  onFileImport,
  onUrlImport,
  onPasteImport,
  disabled = false,
  isImporting = false,
}: ImportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close dropdown when pressing Escape
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handlers: Record<ImportSource, () => void> = {
    file: onFileImport,
    url: onUrlImport,
    paste: onPasteImport,
  };

  const handleSelect = (source: ImportSource) => {
    setIsOpen(false);
    handlers[source]();
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || isImporting}
        className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {isImporting ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white dark:border-zinc-900/30 dark:border-t-zinc-900" />
            Importing...
          </>
        ) : (
          <>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Import
            <svg
              className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-48 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
          {IMPORT_OPTIONS.map(({ source, label, iconPath }) => (
            <button
              key={source}
              onClick={() => handleSelect(source)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <svg
                className="h-5 w-5 text-zinc-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
              </svg>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
