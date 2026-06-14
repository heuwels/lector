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
        isActive ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-500 dark:text-zinc-400'
      }`
    : `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        isActive
          ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
          : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50'
      }`;

  return (
    <Link key={link.href} href={link.href} className={linkClasses}>
      <Icon size="20" />
      {link.label}
    </Link>
  );
}
