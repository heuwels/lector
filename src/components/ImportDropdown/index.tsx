'use client';

import { ChevronDown, Plus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { IMPORT_OPTIONS } from './constants';
import type { ImportDropdownProps, ImportSource } from './types';

export default function ImportDropdown({
  onFileImport,
  onAudioImport,
  onUrlImport,
  onYouTubeImport,
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
    audio: onAudioImport,
    url: onUrlImport,
    youtube: onYouTubeImport,
    paste: onPasteImport,
  };

  const handleSelect = (source: ImportSource) => {
    setIsOpen(false);
    handlers[source]();
  };

  return (
    <div ref={dropdownRef} className="relative">
      <Button onClick={() => setIsOpen(!isOpen)} disabled={disabled || isImporting}>
        {isImporting ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
            Importing...
          </>
        ) : (
          <>
            <Plus className="h-5 w-5" />
            Import
            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </>
        )}
      </Button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-48 rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg">
          {IMPORT_OPTIONS.map(({ source, label, icon: Icon }) => (
            <button
              key={source}
              onClick={() => handleSelect(source)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-popover-foreground transition-colors hover:bg-accent"
            >
              <Icon size="20" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
