'use client';

import clsx from 'clsx';
import { usePathname } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageSelector from '@/components/LanguageSelector';
import { isBareRoute } from '@/lib/auth-client';
import { useSidebarCollapsed } from '@/utils/hooks';
import {
  advancePostOnboardingTour,
  finishPostOnboardingTour,
  usePostOnboardingTour,
} from '@/lib/post-onboarding-tour';
import { navLinks } from './constants';
import NavLink from './components/NavLink';
import AppName from './components/AppName';
import AccountMenu from './components/AccountMenu';
import AdminNavLink from './components/AdminNavLink';
import SidebarCollapseButton from './components/SidebarCollapseButton';
import type { NavTourTip } from './components/NavLink';

export default function NavHeader() {
  const pathname = usePathname();
  const postOnboardingTour = usePostOnboardingTour();
  const { collapsed, setCollapsed } = useSidebarCollapsed();

  const tourTipFor = (href: string): NavTourTip | undefined => {
    if (postOnboardingTour?.stage === 'practice' && href === '/practice') {
      return {
        title: 'Practice later',
        body: 'Go to the Practice tab to review words later.',
        testId: 'post-onboarding-practice-tip',
        onNavigate: () => advancePostOnboardingTour('vocab'),
        onDismiss: finishPostOnboardingTour,
      };
    }
    if (postOnboardingTour?.stage === 'vocab' && href === '/vocab') {
      return {
        title: 'Your vocabulary',
        body: "Review the vocabulary you've interacted with in the Vocabulary tab.",
        testId: 'post-onboarding-vocab-tip',
        onNavigate: () => advancePostOnboardingTour('anki'),
        onDismiss: finishPostOnboardingTour,
      };
    }
    return undefined;
  };

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
      <aside
        className={clsx(
          'sticky top-0 z-50 hidden h-screen border-r border-border bg-card sm:flex sm:flex-col print:hidden',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        <div className={clsx('flex h-16 items-center', collapsed ? 'justify-center px-0' : 'px-5')}>
          <AppName hideName={collapsed} />
        </div>

        <div className="border-b border-border pb-2">
          <LanguageSelector collapsed={collapsed} />
        </div>

        <nav className={clsx('flex-1 space-y-1 py-2', collapsed ? 'px-1' : 'px-3')}>
          {navLinks.map((link) => {
            return (
              <NavLink
                key={link.href}
                link={link}
                isMobile={false}
                collapsed={collapsed}
                tourTip={tourTipFor(link.href)}
              />
            );
          })}
          <AdminNavLink isMobile={false} collapsed={collapsed} />
        </nav>

        <div className={clsx(collapsed ? 'flex justify-center py-1' : '')}>
          <AccountMenu compact={collapsed} />
        </div>

        <div
          className={clsx(
            'border-t border-border',
            collapsed
              ? 'flex flex-col items-center gap-2 px-1 py-3'
              : 'flex items-center justify-between gap-2 px-4 py-3',
          )}
        >
          <ThemeToggle vertical={collapsed} />
          <SidebarCollapseButton collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        </div>
      </aside>

      {/* Mobile bottom nav — hidden on sm+ */}
      <nav className="fixed right-0 bottom-0 left-0 z-50 border-t border-border bg-card sm:hidden print:hidden">
        <div className="flex items-stretch">
          {navLinks.map((link) => {
            return <NavLink key={link.href} link={link} isMobile tourTip={tourTipFor(link.href)} />;
          })}
          <AdminNavLink isMobile />
        </div>
      </nav>
    </>
  );
}
