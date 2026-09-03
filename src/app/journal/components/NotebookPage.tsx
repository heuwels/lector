import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { splitDateParts } from '../utils';

export type JournalFace = 'writing' | 'corrections' | 'critique' | 'revision';

const FACE_LABELS: Record<JournalFace, string> = {
  writing: 'Your writing',
  corrections: 'Corrections',
  critique: 'Critique',
  revision: 'Revision',
};

export default function NotebookPage({
  title,
  entryDate,
  faces,
  face,
  onFaceChange,
  canPrev,
  canNext,
  onPrev,
  onNext,
  children,
}: {
  title: string;
  entryDate: string;
  faces: JournalFace[];
  face: JournalFace;
  onFaceChange: (face: JournalFace) => void;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  children: ReactNode;
}) {
  const { day, month, year } = splitDateParts(entryDate);

  return (
    <div className="relative flex min-h-[32rem] flex-1 flex-col">
      <div className="absolute inset-y-3 -left-2 w-3 rounded-l-sm bg-[color-mix(in_srgb,var(--lip)_80%,var(--card))] md:inset-y-4" />
      <div className="journal-spine relative flex min-h-[32rem] flex-1 flex-col overflow-hidden rounded-l-sm rounded-r-2xl border border-border bg-card">
        <header className="flex h-16 items-center gap-3 border-b border-[var(--lip)] px-5 sm:px-8">
          <h2 className="mr-auto truncate font-reading text-lg text-foreground sm:text-xl">
            {title}
          </h2>
          <div className="flex items-center gap-1 font-reading text-sm tracking-wide text-muted-foreground">
            <DateCell value={day} />
            <span>/</span>
            <DateCell value={month} />
            <span>/</span>
            <DateCell value={year} />
          </div>
        </header>

        <div className="relative flex-1">
          <div className="journal-margin absolute top-0 bottom-0 left-10 w-px sm:left-14" />
          <div className="journal-lines h-full min-h-[24rem] pl-12 sm:pl-16">{children}</div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[var(--lip)] px-3 py-2 sm:px-5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onPrev}
            disabled={!canPrev}
            aria-label="Older entry"
          >
            <ChevronLeft className="h-4 w-4" />
            Older
          </Button>
          {faces.length > 1 && (
            <div className="flex flex-wrap justify-center gap-1">
              {faces.map((item) => (
                <Button
                  key={item}
                  type="button"
                  size="xs"
                  variant={item === face ? 'secondary' : 'ghost'}
                  onClick={() => onFaceChange(item)}
                >
                  {FACE_LABELS[item]}
                </Button>
              ))}
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onNext}
            disabled={!canNext}
            aria-label="Newer entry"
          >
            Newer
            <ChevronRight className="h-4 w-4" />
          </Button>
        </footer>
      </div>
    </div>
  );
}

function DateCell({ value }: { value: string }) {
  return (
    <span className="min-w-7 border-b border-[var(--lip)] px-1 text-center text-foreground">
      {value}
    </span>
  );
}
