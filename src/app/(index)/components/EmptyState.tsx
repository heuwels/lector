import { BookOpen, CloudUpload, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function EmptyState({
  onImport,
  onAddStarter,
  isAddingStarter = false,
}: {
  onImport: () => void;
  /** Present only when the active language has an unseeded starter pack (#315). */
  onAddStarter?: () => void;
  isAddingStarter?: boolean;
}) {
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
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Button onClick={onImport} size="lg">
          <CloudUpload className="h-5 w-5" />
          Import Book
        </Button>
        {onAddStarter && (
          <Button
            onClick={onAddStarter}
            disabled={isAddingStarter}
            size="lg"
            variant="outline"
            data-testid="add-starter-content"
          >
            <Sparkles className="h-5 w-5" />
            {isAddingStarter ? 'Adding…' : 'Add starter content'}
          </Button>
        )}
      </div>
    </div>
  );
}
