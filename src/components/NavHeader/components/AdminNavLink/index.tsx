'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLectorMode } from '@/lib/use-env';
import { checkAdminAccess } from '@/lib/admin-client';
import { getNavLinkClassname } from '../utils';

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
    return getNavLinkClassname({ isActive, isMobile, collapsed });
  }, [isActive, isMobile, collapsed]);

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
