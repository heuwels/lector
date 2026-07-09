'use client';

import { usePathname } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageSelector from '@/components/LanguageSelector';
import { isBareRoute } from '@/lib/auth-client';
import { navLinks } from './constants';
import NavLink from './components/NavLink';
import AppName from './components/AppName';
import AccountMenu from './components/AccountMenu';
import AdminNavLink from './components/AdminNavLink';

export default function NavHeader() {
  const pathname = usePathname();

  // Auth pages are pre-session chrome (#218): no nav — its links would all
  // 401 for a signed-out cloud visitor. Same on /subscribe (#224), where
  // they'd all 402 for a locked account.
  if (isBareRoute(pathname)) return null;

  return (
    <>
      {/* Mobile top bar — language selector, visible only on mobile */}
      <div className="flex h-[var(--mobile-topbar-h)] items-center justify-between border-b border-border bg-card/80 px-3 py-2 backdrop-blur-sm sm:hidden print:hidden">
        <AppName />
        <div className="flex items-center gap-1">
          <LanguageSelector compact />
          <AccountMenu compact />
        </div>
      </div>

      {/* Desktop left sidebar — hidden on mobile */}
      <aside className="sticky top-0 z-50 hidden h-screen w-56 border-r border-border bg-card sm:flex sm:flex-col print:hidden">
        <div className="flex h-16 items-center px-5">
          <AppName />
        </div>

        <div className="border-b border-border pb-2">
          <LanguageSelector />
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {navLinks.map((link) => {
            return <NavLink key={link.href} link={link} isMobile={false} />;
          })}
          <AdminNavLink isMobile={false} />
        </nav>

        <AccountMenu />

        <div className="border-t border-border px-4 py-3">
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile bottom nav — hidden on sm+ */}
      <nav className="fixed right-0 bottom-0 left-0 z-50 border-t border-border bg-card sm:hidden print:hidden">
        <div className="flex items-stretch">
          {navLinks.map((link) => {
            return <NavLink key={link.href} link={link} isMobile />;
          })}
          <AdminNavLink isMobile />
        </div>
      </nav>
    </>
  );
}
