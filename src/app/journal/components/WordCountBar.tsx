import type { JournalWordStats } from '@/lib/data-layer';

export default function WordCountBar({ stats }: { stats: JournalWordStats }) {
  return (
    <p className="text-sm text-muted-foreground" data-testid="journal-word-counts">
      <span className="font-medium text-foreground">{stats.month.toLocaleString()}</span>
      {' words this month · '}
      <span className="font-medium text-foreground">{stats.year.toLocaleString()}</span>
      {' this year · '}
      <span className="font-medium text-foreground">{stats.lifetime.toLocaleString()}</span>
      {' all time'}
    </p>
  );
}
