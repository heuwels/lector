import { useState, type ReactNode } from 'react';
import { Correction } from '@/lib/data-layer';
import CorrectionBadge from './CorrectionBadge';

export default function HighlightedText({
  body,
  corrections,
}: {
  body: string;
  corrections: Correction[];
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  if (corrections.length === 0) {
    return <span>{body}</span>;
  }

  // Find correction positions in the original text via substring search
  type Span = { start: number; end: number; correctionIdx: number };
  const spans: Span[] = [];
  for (let i = 0; i < corrections.length; i++) {
    const c = corrections[i];
    // Search from after the last found span to handle duplicates
    const searchFrom = spans.length > 0 ? spans[spans.length - 1].end : 0;
    const idx = body.indexOf(c.original, searchFrom);
    if (idx !== -1) {
      spans.push({ start: idx, end: idx + c.original.length, correctionIdx: i });
    }
  }

  // Sort by position
  spans.sort((a, b) => a.start - b.start);

  // Build segments
  const segments: ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      segments.push(<span key={`t-${cursor}`}>{body.slice(cursor, span.start)}</span>);
    }
    const c = corrections[span.correctionIdx];
    const isActive = activeIdx === span.correctionIdx;
    segments.push(
      <span key={`c-${span.correctionIdx}`} className="relative inline">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setActiveIdx(isActive ? null : span.correctionIdx);
          }}
          className="-mx-0.5 cursor-pointer rounded px-0.5 text-red-700 underline decoration-red-400 decoration-wavy underline-offset-4 transition-colors hover:bg-red-50 dark:text-red-400 dark:decoration-red-500 dark:hover:bg-red-950/30"
        >
          {body.slice(span.start, span.end)}
        </button>
        {isActive && (
          <span className="absolute top-full left-0 z-10 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            <span className="mb-1 flex items-center gap-2">
              <CorrectionBadge type={c.type} />
            </span>
            <span className="mb-1 block text-sm">
              <span className="text-red-600 line-through dark:text-red-400">{c.original}</span>
              {' → '}
              <span className="font-medium text-green-700 dark:text-green-400">{c.corrected}</span>
            </span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{c.explanation}</span>
          </span>
        )}
      </span>,
    );
    cursor = span.end;
  }
  if (cursor < body.length) {
    segments.push(<span key={`t-${cursor}`}>{body.slice(cursor)}</span>);
  }

  return <span onClick={() => setActiveIdx(null)}>{segments}</span>;
}
