'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getSetting } from '@/lib/data-layer';
import { readLanguageCache, writeLanguageCache } from '@/lib/language-cache';
import { isBareRoute } from '@/lib/auth-client';

export default function SetupGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // The first render must be identical on the server and the client, so we must
  // not read localStorage here — doing so rendered the spinner on the server but
  // the children on the client, which was the hydration mismatch. /setup is
  // always allowed through, as are the auth pages (#218) — they render
  // pre-session, when the settings probe below could only 401 — and
  // /subscribe (#224), where a locked account's probe could only 402; every
  // other route resolves in the effect below.
  const [checked, setChecked] = useState(pathname === '/setup' || isBareRoute(pathname));
  const [error, setError] = useState(false);

  useEffect(() => {
    if (checked || pathname === '/setup' || isBareRoute(pathname)) return;

    let cancelled = false;

    async function checkLanguage() {
      // Fast path: a cached language means setup is already done — skip the
      // network round-trip in the common case. The cache is keyed by tenant
      // (#281): this only ever sees the CURRENT user's value, so another
      // account's (or the pre-flip app's) browser leftovers can no longer
      // bypass setup. AuthGuard sits above us, so in cloud the session — and
      // with it the cache tenant — is resolved before this runs.
      if (readLanguageCache()) {
        setChecked(true);
        return;
      }

      try {
        // The server-side setting is the source of truth; on a hit, backfill
        // this browser's keyed cache so the fast path works next load.
        const serverLang = await getSetting<string>('targetLanguage');
        if (cancelled) return;
        if (serverLang) {
          writeLanguageCache(serverLang);
          setChecked(true);
          return;
        }
      } catch {
        if (cancelled) return;
        setError(true);
        return;
      }

      if (!cancelled) router.replace('/setup');
    }

    checkLanguage();
    return () => {
      cancelled = true;
    };
  }, [checked, pathname, router]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <p className="text-sm text-muted-foreground">Could not connect to the server.</p>
        <Button
          onClick={() => {
            setError(false);
            setChecked(false);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  // Mirrors the effect's own bail-out condition above. Without the pathname
  // check, arriving at /setup via the router.replace() below (rather than a
  // hard load) re-renders with checked still false — the effect bails out
  // before ever setting it — and the spinner never clears.
  if (!checked && pathname !== '/setup' && !isBareRoute(pathname)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
