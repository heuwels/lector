'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getSetting, setSetting } from '@/lib/data-layer';
import { readLanguageCache, writeLanguageCache } from '@/lib/language-cache';
import { isBareRoute } from '@/lib/auth-client';
import { Spinner } from '@/components/ui/spinner';

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
      // blocking network round-trip in the common case. The cache is keyed by
      // tenant (#281): this only ever sees the CURRENT user's value, so another
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

  // Give an account with no stored language one that matches this browser.
  //
  // A few server paths have no request to read a language from — the Anki
  // export and the onboarding snapshot — so they read the `targetLanguage`
  // setting. That setting falls back to the default language when the row is
  // absent, which silently puts those paths on a different language from the
  // one the user reads in. Write the row so they agree.
  //
  // Backfill only. A row that exists is left alone even when it differs: the
  // browser cache is the language the user chose here, and the setting may be
  // a deliberate choice on another device. Every language-scoped request now
  // names its own language, so the two can differ without breaking a read.
  //
  // This runs once per page load, and it cannot live in the effect above: the
  // fast path there returns before any network call, and awaiting this would
  // lose it — `setChecked(true)` re-runs that effect, and the cleanup cancels
  // whatever is in flight.
  const backfilled = useRef(false);
  useEffect(() => {
    if (backfilled.current || pathname === '/setup' || isBareRoute(pathname)) return;
    const cached = readLanguageCache();
    if (!cached) return;
    backfilled.current = true;

    let cancelled = false;
    (async () => {
      // Null is the API's answer for "no such setting". Undefined means the
      // read itself failed, and must not be read as an absent row.
      const serverLang = await getSetting<string | null>('targetLanguage');
      if (cancelled || serverLang !== null) return;
      await setSetting('targetLanguage', cached);
    })().catch(() => {
      // Offline, or a transient API failure. Try again on the next load.
      backfilled.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

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
        <Spinner size="lg" label="Loading setup" className="text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
