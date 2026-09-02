import type { ReactNode } from 'react';

/** Reserved column for the docked drawer on `2xl`. Hidden on smaller screens. */
export function TranslationDrawerSlot({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="translation-drawer-slot"
      className="hidden w-96 shrink-0 flex-col self-stretch 2xl:flex print:hidden"
    >
      {children}
    </div>
  );
}
