'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getSetting } from '@/lib/data-layer';

export default function SetupGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // The first render must be identical on the server and the client, so we must
  // not read localStorage here — doing so rendered the spinner on the server but
  // the children on the client, which was the hydration mismatch. /setup is
  // always allowed through; every other route resolves in the effect below.
  const [checked, setChecked] = useState(pathname === '/setup');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (checked || pathname === '/setup') return;

    let cancelled = false;

    async function checkLanguage() {
      // Fast path: a cached language means setup is already done — skip the
      // network round-trip in the common case.
      if (localStorage.getItem('lector-target-language')) {
        setChecked(true);
        return;
      }

      try {
        const serverLang = await getSetting<string>('targetLanguage');
        if (cancelled) return;
        if (serverLang) {
          localStorage.setItem('lector-target-language', serverLang);
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

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
