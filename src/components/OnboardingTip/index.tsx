import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OnboardingTipProps {
  title: string;
  body: string;
  onDismiss: () => void;
  className?: string;
  testId: string;
}

export default function OnboardingTip({
  title,
  body,
  onDismiss,
  className,
  testId,
}: OnboardingTipProps) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        'z-[70] w-64 rounded-xl border border-[var(--gold-lip)] bg-card p-3 text-left shadow-xl',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold tracking-wide text-[var(--gold-strong)] uppercase">
            {title}
          </p>
          <p className="mt-1 text-sm leading-snug font-normal text-foreground">{body}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss onboarding tip"
          className="-mt-1 -mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
