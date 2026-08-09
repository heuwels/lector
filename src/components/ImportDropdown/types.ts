export type ImportSource = 'file' | 'audio' | 'url' | 'youtube' | 'paste';

export interface ImportDropdownProps {
  onFileImport: () => void;
  onAudioImport: () => void;
  onUrlImport: () => void;
  onYouTubeImport: () => void;
  onPasteImport: () => void;
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
}
