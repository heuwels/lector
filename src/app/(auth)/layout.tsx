'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLectorMode } from '@/lib/use-env';
import { Spinner } from '@/components/ui/spinner';

/**
 * Shared shell for the pre-session pages (#218): /login, /register,
 * /reset-password. Full-screen centered card, no app chrome — NavHeader
 * hides itself on these routes and AuthGuard/SetupGuard pass them through.
 *
 * Accounts exist only in cloud mode, so this is also the selfhost gate: the
 * pages never mount there (their session hooks would probe an endpoint the
 * auth-off API doesn't serve) — selfhost visitors bounce straight home.
 * Mode resolves via useLectorMode (window.__ENV__ is invisible to SSR); the
 * first render is the same spinner on both sides.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const mode = useLectorMode();

  useEffect(() => {
    if (mode === 'selfhost') router.replace('/');
  }, [mode, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Lector</h1>
        <p className="mt-2 text-sm text-muted-foreground">Read your way to a new language</p>
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        {mode === 'cloud' ? (
          children
        ) : (
          <div className="flex justify-center py-8" data-testid="auth-mode-pending">
            <Spinner size="lg" label="Loading authentication" className="text-primary" />
          </div>
        )}
      </div>
    </div>
  );
}
