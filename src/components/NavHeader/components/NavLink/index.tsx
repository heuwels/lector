import Link from 'next/link';
import { iconMap } from '../../constants';
import { usePathname } from 'next/navigation';
import OnboardingTip from '@/components/OnboardingTip';

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
  tourTip,
}: {
  isMobile: boolean;
  link: { href: string; label: string };
  tourTip?: NavTourTip;
}) {
  const pathname = usePathname();
  const isActive = pathname === link.href;
  const Icon = iconMap[link.href];
  const linkClasses = isMobile
    ? `flex w-full flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors ${
        isActive ? 'text-primary' : 'text-muted-foreground'
      }`
    : `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        isActive
          ? 'bg-[var(--primary-soft)] font-bold text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`;

  return (
    <div className={isMobile ? 'relative flex flex-1' : 'relative w-full'}>
      <Link
        key={link.href}
        href={link.href}
        className={`${linkClasses} ${
          tourTip
            ? 'relative z-[60] bg-[var(--gold-soft)] text-[var(--gold-strong)] ring-2 ring-[var(--gold-strong)] ring-offset-2 ring-offset-card'
            : ''
        }`}
        data-onboarding-highlight={tourTip ? link.href.slice(1) || 'library' : undefined}
        onClick={tourTip?.onNavigate}
      >
        <Icon size="20" />
        {link.label}
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
