import clsx from 'clsx';

export function getNavLinkClassname({
  isMobile,
  isActive,
  collapsed,
}: {
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
}) {
  if (isMobile) {
    return clsx(
      'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors',
      isActive ? 'text-primary' : 'text-muted-foreground',
    );
  }

  const base = 'flex w-full items-center rounded-lg text-sm font-medium transition-colors';
  const colorClassName = isActive
    ? 'bg-[var(--primary-soft)] font-bold text-primary'
    : 'text-muted-foreground hover:bg-accent hover:text-foreground';

  if (collapsed) {
    return clsx(base, colorClassName, 'p-2.5');
  }

  return clsx(base, 'gap-3 px-3 py-2.5', colorClassName);
}
