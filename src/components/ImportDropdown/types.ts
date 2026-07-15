export type ImportSource = 'file' | 'audio' | 'url' | 'paste';

export interface ImportDropdownProps {
  onFileImport: () => void;
  onAudioImport: () => void;
  onUrlImport: () => void;
  onPasteImport: () => void;
  disabled?: boolean;
  isImporting?: boolean;
}
