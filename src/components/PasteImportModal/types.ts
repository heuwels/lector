export interface PastedArticle {
  title: string;
  author: string;
  content: string;
}

export interface PasteImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (article: PastedArticle) => Promise<void>;
}
