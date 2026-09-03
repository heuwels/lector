import type { Correction, JournalEntry } from '@/lib/data-layer';

export function formatDate(dateStr: string) {
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(isoStr: string) {
  const d = new Date(isoStr);
  return (
    d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  );
}

export type JournalBadge = 'draft' | 'saved' | 'perfect' | 'corrections';

export function journalBadge(entry: {
  status: JournalEntry['status'];
  corrections: Correction[] | null;
}): JournalBadge {
  if (entry.status === 'draft') return 'draft';
  if (entry.corrections === null) return 'saved';
  if (entry.corrections.length === 0) return 'perfect';
  return 'corrections';
}

export function splitDateParts(dateStr: string): { day: string; month: string; year: string } {
  const [year, month, day] = dateStr.slice(0, 10).split('-');
  return { day: day ?? '', month: month ?? '', year: year ?? '' };
}
