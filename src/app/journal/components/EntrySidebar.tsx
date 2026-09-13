import { Trash2 } from 'lucide-react';
import type { JournalEntry } from '@/lib/data-layer';
import { entryLabel, formatMonth, formatTimelineDay, journalBadge } from '../utils';
import StatusBadge from './StatusBadge';

const DOT_COLOURS = {
  draft: 'bg-[var(--gold-strong)]',
  saved: 'bg-muted-foreground/60',
  perfect: 'bg-primary',
  corrections: 'bg-primary',
} as const;

/**
 * Past entries as a vertical timeline: one rail, a dot per entry, and a month
 * divider when the month changes. The list stretches to the page height on
 * desktop and scrolls inside itself.
 */
export default function EntrySidebar({
  entries,
  activeId,
  composing,
  onSelect,
  onDelete,
}: {
  entries: JournalEntry[];
  activeId: string | null;
  composing: boolean;
  onSelect: (entry: JournalEntry) => void;
  onDelete: (id: string) => void;
}) {
  const items: React.ReactNode[] = [];
  let lastMonth: string | null = null;

  for (const entry of entries) {
    const month = entry.entryDate.slice(0, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      items.push(
        <li
          key={`month-${month}`}
          className="sticky top-0 z-10 -ml-6 bg-background pt-2 pb-1 pl-6 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {formatMonth(entry.entryDate)}
        </li>,
      );
    }
    const active = !composing && entry.id === activeId;
    const label = entryLabel(entry) || 'Empty page';
    items.push(
      <li key={entry.id} className="group relative py-1">
        <Dot colour={DOT_COLOURS[journalBadge(entry)]} active={active} />
        <div
          className={`-mx-2 rounded-lg px-2 py-1.5 transition-colors ${
            active ? 'bg-accent' : 'hover:bg-accent/60'
          }`}
        >
          <button type="button" onClick={() => onSelect(entry)} className="block w-full text-left">
            <time
              dateTime={entry.entryDate}
              className="block text-[11px] tracking-wide text-muted-foreground"
            >
              {formatTimelineDay(entry.entryDate)}
            </time>
            <span
              className={`block truncate text-sm ${
                active ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'
              }`}
            >
              {label}
            </span>
          </button>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge entry={entry} />
              <span>
                {entry.wordCount} word{entry.wordCount === 1 ? '' : 's'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onDelete(entry.id)}
              className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
              title="Delete entry"
              aria-label="Delete entry"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </li>,
    );
  }

  return (
    <aside
      className="flex w-full shrink-0 flex-col md:h-full md:w-60"
      data-testid="journal-timeline"
    >
      <h2 className="mb-1 px-1 text-sm font-medium text-muted-foreground">Past entries</h2>
      <ol className="relative max-h-64 min-h-0 flex-1 overflow-y-auto pr-1 pb-4 pl-6 md:max-h-none">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-3 bottom-3 left-[7px] w-px bg-border"
        />
        {composing && (
          <li className="relative py-1">
            <Dot colour="bg-primary" active pulse />
            <div className="-mx-2 rounded-lg bg-accent px-2 py-1.5">
              <span className="block text-[11px] tracking-wide text-muted-foreground">Today</span>
              <span className="block truncate text-sm font-semibold text-primary">New page</span>
            </div>
          </li>
        )}
        {items}
        {entries.length === 0 && !composing && (
          <li className="py-2 text-sm text-muted-foreground">No entries yet.</li>
        )}
      </ol>
    </aside>
  );
}

function Dot({ colour, active, pulse }: { colour: string; active: boolean; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute top-[1.15rem] -left-6 ml-[3.5px] h-2 w-2 rounded-full ring-2 ring-background ${colour} ${
        active
          ? 'scale-125 shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_25%,transparent)]'
          : ''
      } ${pulse ? 'animate-pulse' : ''}`}
    />
  );
}
