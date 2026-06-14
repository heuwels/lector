import { BookOpen, CloudUpload } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-card px-6 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <BookOpen className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <h3 className="mb-2 text-lg font-bold text-foreground">No books in your library</h3>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">
        Import a book (EPUB or Markdown) to start learning. Your vocabulary and progress will be
        tracked as you read.
      </p>
      <Button onClick={onImport} size="lg">
        <CloudUpload className="h-5 w-5" />
        Import Book
      </Button>
    </div>
  );
}
