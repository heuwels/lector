import { correctionTypeLabels } from '../constants';

export default function CorrectionBadge({ type }: { type: string }) {
  const info = correctionTypeLabels[type] || {
    label: type,
    className: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${info.className}`}>
      {info.label}
    </span>
  );
}
