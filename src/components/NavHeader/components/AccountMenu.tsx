'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { useLectorMode } from '@/lib/use-env';

/**
 * Signed-in account row (#218) — cloud mode only. Mode resolves via
 * useLectorMode (window.__ENV__ is invisible to SSR), and the session hook
 * lives in an inner component so selfhost never fetches the nonexistent
 * session endpoint.
 */
export default function AccountMenu({ compact = false }: { compact?: boolean }) {
  const mode = useLectorMode();
  if (mode !== 'cloud') return null;
  return <CloudAccountMenu compact={compact} />;
}

function CloudAccountMenu({ compact }: { compact: boolean }) {
  const { data: session } = authClient.useSession();
  const [signingOut, setSigningOut] = useState(false);

  if (!session) return null;

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      // Hard navigation so every in-memory state and cache resets with the session.
      window.location.assign('/login');
    }
  }

  if (compact) {
    return (
      <button
        onClick={handleSignOut}
        disabled={signingOut}
        aria-label="Sign out"
        data-testid="account-sign-out"
        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
      <span
        className="min-w-0 truncate text-xs text-muted-foreground"
        title={session.user.email}
        data-testid="account-email"
      >
        {session.user.email}
      </span>
      <button
        onClick={handleSignOut}
        disabled={signingOut}
        aria-label="Sign out"
        data-testid="account-sign-out"
        className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
