export interface LessonFormData {
  title: string;
  textContent: string;
}

export interface LessonFormModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initial?: LessonFormData | null;
  onClose: () => void;
  onSave: (data: LessonFormData) => Promise<void>;
}
