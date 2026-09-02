import { cn } from '@/lib/utils';
import { LogOut } from 'lucide-react';
import { ISignOutButtonProps } from './types';

export default function SignOutButton({ disabled, onClick, compact = false }: ISignOutButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="Sign out"
      data-testid="account-sign-out"
      className={cn(
        'rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        !compact ? 'shrink-0' : '',
      )}
    >
      <LogOut className="h-4 w-4" />
    </button>
  );
}
