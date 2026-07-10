'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLectorMode } from '@/lib/use-env';
import { checkAdminAccess } from '@/lib/admin-client';

/**
 * The Admin nav link (#221) — rendered only in cloud mode and only for an
 * account the server confirms is an admin (a 200 from the gated /access
 * probe). A non-admin never sees it; the page and every endpoint are
 * server-enforced regardless, so this is purely to avoid a dead link.
 */
export default function AdminNavLink({ isMobile }: { isMobile: boolean }) {
  const mode = useLectorMode();
  const [isAdmin, setIsAdmin] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (mode !== 'cloud') return;
    let cancelled = false;
    checkAdminAccess()
      .then((ok) => {
        if (!cancelled) setIsAdmin(ok);
      })
      .catch(() => {
        /* not an admin / offline — leave hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  if (!isAdmin) return null;

  const isActive = pathname === '/admin';
  const className = isMobile
    ? `flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors ${
        isActive ? 'text-primary' : 'text-muted-foreground'
      }`
    : `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        isActive
          ? 'bg-[var(--primary-soft)] font-bold text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`;

  return (
    <Link href="/admin" className={className}>
      <ShieldCheck size="20" />
      Admin
    </Link>
  );
}
