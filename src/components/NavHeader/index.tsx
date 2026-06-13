'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageSelector from '@/components/LanguageSelector';
import { navLinks } from './constants';
import NavLink from './components/NavLink';

export default function NavHeader() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile top bar — language selector, visible only on mobile */}
      <div className="fixed top-0 right-0 left-0 z-50 flex h-[var(--mobile-topbar-h)] items-center justify-end border-b border-zinc-200 bg-white/80 px-3 backdrop-blur-sm sm:hidden dark:border-zinc-800 dark:bg-zinc-950/80">
        <LanguageSelector compact />
      </div>

      {/* Desktop left sidebar — hidden on mobile */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-56 border-r border-zinc-200 bg-white sm:flex sm:flex-col dark:border-zinc-800 dark:bg-zinc-950">
        {/* App name */}
        <div className="flex h-16 items-center px-5">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="Lector" width={28} height={28} className="rounded" />
            <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Lector
            </span>
          </Link>
        </div>

        {/* Language selector */}
        <div className="border-b border-zinc-200 pb-2 dark:border-zinc-800">
          <LanguageSelector />
        </div>

        {/* Navigation links */}
        <nav className="flex-1 space-y-1 px-3 py-2">
          {navLinks.map((link) => {
            return <NavLink link={link} pathname={pathname} isMobile={false} />;
          })}
        </nav>

        {/* Bottom: theme toggle */}
        <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile bottom nav — hidden on sm+ */}
      <nav className="fixed right-0 bottom-0 left-0 z-50 border-t border-zinc-200 bg-white sm:hidden dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-stretch">
          {navLinks.map((link) => {
            return <NavLink link={link} pathname={pathname} isMobile />;
          })}
        </div>
      </nav>
    </>
  );
}
