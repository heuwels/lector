'use client';

import { Check, ChevronDown, Plus } from 'lucide-react';
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
  label = 'Import',
  size = 'default',
  variant = 'default',
  testId,
  destinations,
  destinationId = null,
  onDestinationChange,
  minimalOnMobile,
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

  // The ungrouped library is a destination like any group, so it heads the list
  // and stays selectable after the user picks a group.
  const destinationList: Array<{ id: string | null; name: string }> = destinations?.length
    ? [{ id: null, name: 'Library (ungrouped)' }, ...destinations]
    : [];

  return (
    <div ref={dropdownRef} className="relative">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || isImporting}
        size={size}
        variant={variant}
        data-testid={testId}
      >
        {isImporting ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
            <span className={minimalOnMobile ? 'hidden md:block' : ''}>Importing...</span>
          </>
        ) : (
          <>
            <Plus className="h-5 w-5" />
            <span className={minimalOnMobile ? 'hidden items-center sm:flex' : ''}>{label}</span>
          </>
        )}
      </Button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg">
          {destinationList.length > 0 && (
            <div className="mb-1 border-b border-border pb-1">
              <p className="px-4 pt-1.5 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Add to
              </p>
              <div className="max-h-44 overflow-y-auto">
                {destinationList.map((destination) => {
                  const isSelected = destination.id === destinationId;
                  return (
                    <button
                      key={destination.id ?? 'ungrouped'}
                      type="button"
                      onClick={() => onDestinationChange?.(destination.id)}
                      aria-pressed={isSelected}
                      data-testid={`import-destination-${destination.id ?? 'ungrouped'}`}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-popover-foreground transition-colors hover:bg-accent"
                    >
                      <Check
                        className={`h-4 w-4 shrink-0 text-primary ${isSelected ? 'opacity-100' : 'opacity-0'}`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{destination.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
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
