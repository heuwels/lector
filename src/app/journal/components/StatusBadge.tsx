import { journalBadge } from '../utils';
import type { Correction, JournalEntry } from '@/lib/data-layer';

export default function StatusBadge({
  entry,
}: {
  entry: Pick<JournalEntry, 'status' | 'corrections'>;
}) {
  const badge = journalBadge(entry);
  const count = (entry.corrections as Correction[] | null)?.length ?? 0;

  if (badge === 'draft') {
    return (
      <span className="rounded-full bg-[var(--gold-soft)] px-2 py-0.5 text-xs font-medium text-[var(--gold-strong)]">
        Draft
      </span>
    );
  }
  if (badge === 'saved') {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Finished
      </span>
    );
  }
  if (badge === 'perfect') {
    return (
      <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] px-2 py-0.5 text-xs font-medium text-primary">
        Perfect
      </span>
    );
  }
  return (
    <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] px-2 py-0.5 text-xs font-medium text-primary">
      {count} correction{count === 1 ? '' : 's'}
    </span>
  );
}
