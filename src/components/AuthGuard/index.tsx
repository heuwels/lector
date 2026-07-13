'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { bounceToLogin } from '@/lib/api-base';
import { setActiveTenant } from '@/lib/language-cache';
import { useLectorMode } from '@/lib/use-env';
import { authClient, isAuthRoute } from '@/lib/auth-client';
import { Spinner } from '@/components/ui/spinner';

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
        <Spinner size="lg" label="Loading Lector" className="text-primary" />
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

  // Record the session user as the language-cache tenant (#281) during
  // render, not in an effect: parents render before children, so every gated
  // component (SetupGuard's cache fast-path included) reads the keyed cache
  // under the right namespace from its very first render. Idempotent, so
  // re-renders are free; account switches go through hard navigations
  // (bounceToLogin), so a stale in-memory tenant can't outlive its session.
  if (session) setActiveTenant(session.user.id);

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
        <Spinner size="lg" label="Loading session" className="text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
