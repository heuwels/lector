export const TRANSLATION_DRAWER_SLOT_ID = 'translation-drawer-slot';

/** Reserved column for the docked drawer on `2xl`. Hidden on smaller screens. */
export function TranslationDrawerSlot() {
  return (
    <div
      id={TRANSLATION_DRAWER_SLOT_ID}
      data-testid="translation-drawer-slot"
      className="hidden w-96 shrink-0 flex-col self-stretch 2xl:flex print:hidden"
    />
  );
}
