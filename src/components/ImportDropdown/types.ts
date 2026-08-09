export type ImportSource = 'file' | 'audio' | 'url' | 'youtube' | 'paste';

/** A group the import can target, offered in the destination list. */
export interface ImportDestination {
  id: string;
  name: string;
}

export interface ImportDropdownProps {
  onFileImport: () => void;
  onAudioImport: () => void;
  onUrlImport: () => void;
  onYouTubeImport: () => void;
  onPasteImport: () => void;
  minimalOnMobile?: boolean;
  disabled?: boolean;
  isImporting?: boolean;
  /** Trigger label. Defaults to "Import". */
  label?: string;
  /** Trigger size. Use "sm" for the in-group trigger in the library. */
  size?: 'default' | 'sm';
  /** Trigger style. Defaults to the primary button. */
  variant?: 'default' | 'outline';
  /** Applied to the trigger, so a test can address one group's dropdown. */
  testId?: string;
  /**
   * Groups the import can go into. When this list has entries, the menu opens
   * with a destination list above the sources. Leave it empty for a dropdown
   * that already belongs to one group.
   */
  destinations?: ImportDestination[];
  /** The chosen destination. Null is the ungrouped library. */
  destinationId?: string | null;
  onDestinationChange?: (id: string | null) => void;
}
