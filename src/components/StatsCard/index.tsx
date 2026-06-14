import type { StatsCardProps } from './types';

export default function StatsCard({
  label,
  value,
  icon,
  highlight = false,
  testId,
}: StatsCardProps) {
  return (
    <div
      data-testid={testId}
      className={`flex items-center gap-4 rounded-xl border p-4 ${
        highlight
          ? 'border-[var(--gold-lip)] bg-[var(--gold-soft)]'
          : 'panel'
      }`}
    >
      {icon && (
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${
            highlight
              ? 'bg-[var(--gold-soft)] text-[var(--gold-strong)]'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
        <p
          className={`text-2xl font-bold tracking-tight ${
            highlight ? 'text-[var(--gold-strong)]' : 'text-foreground'
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
