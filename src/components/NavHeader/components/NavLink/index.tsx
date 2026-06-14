import Link from 'next/link';
import { iconMap } from '../../constants';
import { usePathname } from 'next/navigation';

export default function NavLink({
  link,
  isMobile,
}: {
  isMobile: boolean;
  link: { href: string; label: string };
}) {
  const pathname = usePathname();
  const isActive = pathname === link.href;
  const Icon = iconMap[link.href];
  const linkClasses = isMobile
    ? `flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors ${
        isActive ? 'text-primary' : 'text-muted-foreground'
      }`
    : `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        isActive
          ? 'bg-[var(--primary-soft)] font-bold text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`;

  return (
    <Link key={link.href} href={link.href} className={linkClasses}>
      <Icon size="20" />
      {link.label}
    </Link>
  );
}
