import type { CustomTooltipProps } from './types';

export default function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800">
      <p className="mb-2 text-sm text-zinc-500 dark:text-slate-400">{label}</p>
      {payload.map((entry, index) => (
        <p key={index} className="text-sm" style={{ color: entry.color }}>
          <span className="capitalize">{entry.dataKey}: </span>
          <span className="font-semibold">{entry.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}
