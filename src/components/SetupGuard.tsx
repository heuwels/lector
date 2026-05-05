'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getSetting } from '@/lib/data-layer';

function getInitialChecked(pathname: string): boolean {
  if (pathname === '/setup') return true;
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('lector-target-language');
}

export default function SetupGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checked, setChecked] = useState(() => getInitialChecked(pathname));
  const [error, setError] = useState(false);

  useEffect(() => {
    if (checked || pathname === '/setup') return;

    let cancelled = false;

    async function checkLanguage() {
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
    return () => { cancelled = true; };
  }, [checked, pathname, router]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Could not connect to the server.</p>
        <button
          onClick={() => { setError(false); setChecked(false); }}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
      </div>
    );
  }

  return <>{children}</>;
}
