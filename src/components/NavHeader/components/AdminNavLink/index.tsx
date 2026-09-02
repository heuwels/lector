'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { useLectorMode } from '@/lib/use-env';
import { checkAdminAccess } from '@/lib/admin-client';

/**
 * The Admin nav link (#221) — rendered only in cloud mode and only for an
 * account the server confirms is an admin
 */
export default function AdminNavLink({
  isMobile,
  collapsed = false,
}: {
  isMobile: boolean;
  collapsed?: boolean;
}) {
  const mode = useLectorMode();
  const [isAdmin, setIsAdmin] = useState(false);
  const pathname = usePathname();
  const isActive = pathname === '/admin';

  const className = useMemo(() => {
    if (isMobile) {
      return clsx(
        'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors',
        isActive ? 'text-primary' : 'text-muted-foreground',
      );
    }

    const base = 'flex w-full items-center rounded-lg text-sm font-medium transition-colors';
    const colorClassName = isActive
      ? 'bg-[var(--primary-soft)] font-bold text-primary'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground';

    if (collapsed) {
      return clsx(base, colorClassName, 'p-2.5');
    }

    return clsx(base, 'gap-3 px-3 py-2.5', colorClassName);
  }, [isMobile, collapsed, isActive]);

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

  return (
    <Link
      href="/admin"
      className={className}
      title={collapsed && !isMobile ? 'Admin' : undefined}
      aria-label={collapsed && !isMobile ? 'Admin' : undefined}
    >
      <ShieldCheck size="20" />
      {!(collapsed && !isMobile) && 'Admin'}
    </Link>
  );
}
