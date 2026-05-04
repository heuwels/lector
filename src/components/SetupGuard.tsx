'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getSetting } from '@/lib/data-layer';

export default function SetupGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Don't redirect if already on setup page
    if (pathname === '/setup') {
      setChecked(true);
      return;
    }

    async function checkLanguage() {
      // 1. Check localStorage first
      const local = localStorage.getItem('lector-target-language');
      if (local) {
        setChecked(true);
        return;
      }

      // 2. Check server setting
      try {
        const serverLang = await getSetting<string>('targetLanguage');
        if (serverLang) {
          // Sync to localStorage
          localStorage.setItem('lector-target-language', serverLang);
          setChecked(true);
          return;
        }
      } catch {
        // Server unavailable — don't redirect to setup
        setChecked(true);
        return;
      }

      // 3. No language set anywhere — redirect to setup
      router.replace('/setup');
    }

    checkLanguage();
  }, [pathname, router]);

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
      </div>
    );
  }

  return <>{children}</>;
}
