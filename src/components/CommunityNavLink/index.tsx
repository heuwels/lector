'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users } from 'lucide-react';
import { useLectorMode } from '@/lib/use-env';

export default function CommunityNavLink({ isMobile }: { isMobile: boolean }) {
  const mode = useLectorMode();
  const pathname = usePathname();

  if (mode !== 'cloud') return null;

  const isActive = pathname === '/community' || pathname.startsWith('/community/');
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
    <Link href="/community" className={className} data-testid="nav-community">
      <Users size="20" />
      Community
    </Link>
  );
}
