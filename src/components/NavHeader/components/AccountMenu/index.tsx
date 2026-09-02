'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { useLectorMode } from '@/lib/use-env';
import SignOutButton from './components/SignOutButton';

export default function AccountMenu({ compact = false }: { compact?: boolean }) {
  const mode = useLectorMode();

  if (mode !== 'cloud') {
    return null;
  }

  return <CloudAccountMenu compact={compact} />;
}

function CloudAccountMenu({ compact }: { compact: boolean }) {
  const { data: session } = authClient.useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);

  if (!session) return null;

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      // Hard navigation so every in-memory state and cache resets with the session.
      window.location.assign('/login');
    }
  }

  if (compact) {
    return <SignOutButton compact onClick={handleSignOut} disabled={isSigningOut} />;
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
      <SignOutButton onClick={handleSignOut} disabled={isSigningOut} />
    </div>
  );
}
