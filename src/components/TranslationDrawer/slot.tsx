import type { ReactNode } from 'react';

/** Reserved column for the docked drawer on `lg+`. Hidden below `lg` (bottom sheet takes over). */
export function TranslationDrawerSlot({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="translation-drawer-slot"
      className="hidden w-96 shrink-0 flex-col self-stretch lg:flex print:hidden"
    >
      {children}
    </div>
  );
}
