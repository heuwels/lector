'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { bounceToLogin } from '@/lib/api-base';
import { useLectorMode } from '@/lib/use-env';
import { authClient, isAuthRoute } from '@/lib/auth-client';

/**
 * Cloud-mode session gate (#218). Wraps SetupGuard in the root layout:
 * nothing app-shaped renders (and SetupGuard's settings probe never fires)
 * until a session exists, so an unauthenticated visitor lands on /login
 * instead of racing SetupGuard to /setup.
 *
 * Mode resolves via useLectorMode (hydration-safe — window.__ENV__ is
 * invisible to SSR and the first render must be identical on both sides, the
 * SetupGuard lesson). Selfhost passes through without ever mounting the
 * session hook — useSession fires a fetch on mount, and the auth-off API has
 * no /api/auth/* to answer it.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const mode = useLectorMode();

  if (mode === 'unknown') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  if (mode === 'selfhost') return <>{children}</>;

  return <CloudSessionGate>{children}</CloudSessionGate>;
}

function CloudSessionGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  const onAuthRoute = isAuthRoute(pathname);

  useEffect(() => {
    if (isPending || onAuthRoute || session) return;
    // Shared idempotent hard redirect — a soft router.replace here races the
    // 401 bounce from apiFetch (outside-guard components fetch on mount) and
    // whichever navigation loses aborts (net::ERR_ABORTED).
    bounceToLogin();
  }, [isPending, onAuthRoute, session]);

  // Auth pages own their inverse redirect (session → /) and render regardless.
  if (onAuthRoute) return <>{children}</>;

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
