'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { bounceToSubscribe, BILLING_ROUTE } from '@/lib/api-base';
import { useLectorMode } from '@/lib/use-env';
import { isAuthRoute } from '@/lib/auth-client';
import { fetchBillingStatus } from '@/lib/billing';

/**
 * Cloud-mode subscription gate (#224), AuthGuard's billing sibling. Sits
 * between AuthGuard and SetupGuard in the root layout, so it only ever runs
 * with a session resolved: one status probe per hard load, and a locked
 * account is bounced to /subscribe before anything app-shaped renders or
 * fires its own (soon-to-402) fetches.
 *
 * This is UX, not enforcement — the API's billing middleware 402s every
 * gated call regardless, and apiFetch turns any stray 402 into the same
 * bounce.
 */
export default function BillingGuard({ children }: { children: React.ReactNode }) {
  const mode = useLectorMode();

  // Selfhost never bills; 'unknown' (SSR frame) is unreachable in practice —
  // AuthGuard above renders a spinner instead of children until mode resolves.
  if (mode !== 'cloud') return <>{children}</>;

  return <CloudBillingGate>{children}</CloudBillingGate>;
}

function CloudBillingGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Auth routes render pre-session (a probe could only 401); /subscribe does
  // its own status fetch and must render for exactly the accounts this guard
  // locks out.
  const skip = isAuthRoute(pathname) || pathname === BILLING_ROUTE;
  const [state, setState] = useState<'pending' | 'ok' | 'locked'>('pending');

  useEffect(() => {
    if (skip || state !== 'pending') return;
    let cancelled = false;
    fetchBillingStatus().then((status) => {
      if (cancelled) return;
      setState(status === null || status.accessAllowed ? 'ok' : 'locked');
    });
    return () => {
      cancelled = true;
    };
  }, [skip, state]);

  useEffect(() => {
    if (state === 'locked') bounceToSubscribe();
  }, [state]);

  if (skip) return <>{children}</>;

  // 'locked' keeps the spinner while the hard redirect lands.
  if (state !== 'ok') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
