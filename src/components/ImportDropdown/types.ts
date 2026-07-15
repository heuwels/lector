export type ImportSource = 'file' | 'url' | 'youtube' | 'paste';

export interface ImportDropdownProps {
  onFileImport: () => void;
  onUrlImport: () => void;
  onYouTubeImport: () => void;
  onPasteImport: () => void;
  disabled?: boolean;
  isImporting?: boolean;
}
