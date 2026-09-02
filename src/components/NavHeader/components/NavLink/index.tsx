import Link from 'next/link';
import clsx from 'clsx';
import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import OnboardingTip from '@/components/OnboardingTip';
import { iconMap } from '../../constants';
import { getNavLinkClassname } from '../utils';

export interface NavTourTip {
  title: string;
  body: string;
  testId: string;
  onNavigate: () => void;
  onDismiss: () => void;
}

export default function NavLink({
  link,
  isMobile,
  collapsed = false,
  tourTip,
}: {
  isMobile: boolean;
  collapsed?: boolean;
  link: { href: string; label: string };
  tourTip?: NavTourTip;
}) {
  const pathname = usePathname();
  const isActive = pathname === link.href;
  const Icon = iconMap[link.href];
  const linkClasses = useMemo(() => {
    return getNavLinkClassname({ isActive, isMobile, collapsed });
  }, [isActive, isMobile, collapsed]);

  return (
    <div className={isMobile ? 'relative flex flex-1' : 'relative w-full'}>
      <Link
        key={link.href}
        href={link.href}
        className={clsx(
          linkClasses,
          tourTip
            ? 'relative z-60 bg-[var(--gold-soft)] text-[var(--gold-strong)] ring-2 ring-[var(--gold-strong)] ring-offset-2 ring-offset-card'
            : '',
        )}
        data-onboarding-highlight={tourTip ? link.href.slice(1) || 'library' : undefined}
        onClick={tourTip?.onNavigate}
        title={collapsed && !isMobile ? link.label : undefined}
        aria-label={collapsed && !isMobile ? link.label : undefined}
      >
        <Icon size="20" />
        {!(collapsed && !isMobile) && link.label}
      </Link>
      {tourTip && (
        <OnboardingTip
          title={tourTip.title}
          body={tourTip.body}
          onDismiss={tourTip.onDismiss}
          testId={`${tourTip.testId}-${isMobile ? 'mobile' : 'desktop'}`}
          className={
            isMobile
              ? 'fixed right-3 bottom-20 left-3 block w-auto sm:hidden'
              : 'absolute top-0 left-[calc(100%+0.75rem)] hidden sm:block'
          }
        />
      )}
    </div>
  );
}
