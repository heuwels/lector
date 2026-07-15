export type ImportSource = 'file' | 'audio' | 'url' | 'youtube' | 'paste';

export interface ImportDropdownProps {
  onFileImport: () => void;
  onAudioImport: () => void;
  onUrlImport: () => void;
  onYouTubeImport: () => void;
  onPasteImport: () => void;
  disabled?: boolean;
  isImporting?: boolean;
}
