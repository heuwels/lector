'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { bounceToLogin } from '@/lib/api-base';
import { setActiveTenant } from '@/lib/language-cache';
import { useLectorMode } from '@/lib/use-env';
import { authClient, isAuthRoute } from '@/lib/auth-client';
import { getImpersonationStatus, type ImpersonationStatus } from '@/lib/admin-client';
import ImpersonationBanner from '@/components/ImpersonationBanner';
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
  const [impersonation, setImpersonation] = useState<ImpersonationStatus | null>(null);

  // Admin impersonation (#320): while a grant is active, the API serves the
  // TARGET's data on ordinary routes, so the client's tenant-keyed caches must
  // namespace under the target too — else the operator's own cached data would
  // sit over the target's view. Probe once per session; a non-admin (or an
  // operator who isn't impersonating) just gets { active: false }.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let live = true;
    getImpersonationStatus()
      .then((s) => live && setImpersonation(s))
      .catch(() => live && setImpersonation({ active: false }));
    return () => {
      live = false;
    };
  }, [userId]);

  // Effective tenant = the impersonation target while active, else the session
  // user. Set during render (not an effect) so gated children read the right
  // namespace from their first render — the #281 rule. When the async probe
  // flips this operator→target, setActiveTenant clears the query cache (same
  // machinery as a language switch), so no cross-account data survives.
  if (session) {
    const effectiveTenant =
      impersonation?.active && impersonation.targetUserId
        ? impersonation.targetUserId
        : session.user.id;
    setActiveTenant(effectiveTenant);
  }

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

  return (
    <>
      {impersonation?.active && <ImpersonationBanner status={impersonation} />}
      {children}
    </>
  );
}
