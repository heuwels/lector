export default function SummaryStat({
  value,
  label,
  colorClassName,
}: {
  value: number;
  label: string;
  colorClassName: string;
}) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${colorClassName}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-zinc-500 dark:text-slate-400">{label}</div>
    </div>
  );
}
