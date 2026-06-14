'use client';

import ThemeToggle from '@/components/ThemeToggle';
import LanguageSelector from '@/components/LanguageSelector';
import { navLinks } from './constants';
import NavLink from './components/NavLink';
import AppName from './components/AppName';

export default function NavHeader() {
  return (
    <>
      {/* Mobile top bar — language selector, visible only on mobile */}
      <div className="flex h-[var(--mobile-topbar-h)] items-center justify-between border-b border-zinc-200 bg-white/80 px-3 py-2 backdrop-blur-sm sm:hidden dark:border-zinc-800 dark:bg-zinc-950/80">
        <AppName />
        <LanguageSelector compact />
      </div>

      {/* Desktop left sidebar — hidden on mobile */}
      <aside className="sticky top-0 z-50 hidden h-screen w-56 border-r border-zinc-200 bg-white sm:flex sm:flex-col dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex h-16 items-center px-5">
          <AppName />
        </div>

        <div className="border-b border-zinc-200 pb-2 dark:border-zinc-800">
          <LanguageSelector />
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {navLinks.map((link) => {
            return <NavLink key={link.href} link={link} isMobile={false} />;
          })}
        </nav>

        <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile bottom nav — hidden on sm+ */}
      <nav className="fixed right-0 bottom-0 left-0 z-50 border-t border-zinc-200 bg-white sm:hidden dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-stretch">
          {navLinks.map((link) => {
            return <NavLink key={link.href} link={link} isMobile />;
          })}
        </div>
      </nav>
    </>
  );
}
