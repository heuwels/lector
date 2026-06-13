export type ImportSource = 'file' | 'url' | 'paste';

export interface ImportDropdownProps {
  onFileImport: () => void;
  onUrlImport: () => void;
  onPasteImport: () => void;
  disabled?: boolean;
  isImporting?: boolean;
}
