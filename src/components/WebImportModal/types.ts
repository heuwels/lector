import type { ExtractedArticle } from '@/app/api/extract-url/route';

export interface WebImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (article: { title: string; author: string; content: string }) => Promise<void>;
}

export type ModalState =
  | { phase: 'input' }
  | { phase: 'loading' }
  | { phase: 'preview'; data: ExtractedArticle }
  | { phase: 'saving' }
  | { phase: 'error'; message: string };
