/**
 * Response contract for an extracted article, returned by the Hono API
 * (api/src/routes/extract-url.ts) and consumed by the WebImportModal client
 * components.
 */
export interface ExtractedArticle {
  title: string;
  author: string | null;
  content: string;
  siteName: string | null;
  excerpt: string | null;
  wordCount: number;
}

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
