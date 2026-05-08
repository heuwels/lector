interface StatsCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  highlight?: boolean;
  testId?: string;
}

export default function StatsCard({ label, value, icon, highlight = false, testId }: StatsCardProps) {
  return (
    <div
      data-testid={testId}
      className={`flex items-center gap-4 rounded-xl border p-4 ${
        highlight
          ? 'border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 dark:border-amber-900/50 dark:from-amber-950/30 dark:to-orange-950/30'
          : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
      }`}
    >
      {icon && (
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${
            highlight
              ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400'
              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
          }`}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
        <p
          className={`text-2xl font-bold tracking-tight ${
            highlight
              ? 'text-amber-700 dark:text-amber-400'
              : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
