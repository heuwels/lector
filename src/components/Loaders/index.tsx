import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Branded scene loaders (design sheet: lector-design-demos/10-spinners.html).
 * Placement follows the #147 style guide: the reader stays calm
 * (ReadingSweep, or the ring in ui/spinner), practice surfaces carry the
 * energy (MasteryRipple, DeckShuffle), and PageTurn is reserved for big
 * waits — opening a lesson, importing a book. All are CSS-only (globals.css)
 * and pause under prefers-reduced-motion.
 */

type SceneProps = Omit<ComponentProps<'div'>, 'children'> & { label?: string };

function sceneA11y(label: string | undefined) {
  return {
    role: label ? ('status' as const) : undefined,
    'aria-label': label,
    'aria-hidden': label ? undefined : true,
  };
}

/** Five dots climbing the word-state ramp (new → L1..L4 → known). The
 *  font-size is the dot diameter: text-[7px] reads inline in a chip. */
export function MasteryRipple({ className, label, ...props }: SceneProps) {
  return (
    <div className={cn('mastery-ripple text-[13px]', className)} {...sceneA11y(label)} {...props}>
      <i></i>
      <i></i>
      <i></i>
      <i></i>
      <i></i>
    </div>
  );
}

/** An open spread with a turning leaf — lesson opens and imports only. */
export function PageTurn({ className, label, ...props }: SceneProps) {
  return (
    <div className={cn('page-turn', className)} {...sceneA11y(label)} {...props}>
      <div className="page-turn-side page-turn-side--left"></div>
      <div className="page-turn-side page-turn-side--right"></div>
      <div className="page-turn-spine"></div>
      <div className="page-turn-leaf">
        <div className="page-turn-face"></div>
        <div className="page-turn-face page-turn-face--back"></div>
      </div>
    </div>
  );
}

/** Three lip-edged flashcards cycling to the back of the pile. */
export function DeckShuffle({ className, label, ...props }: SceneProps) {
  return (
    <div className={cn('deck-shuffle', className)} {...sceneA11y(label)} {...props}>
      <b>a</b>
      <b>ê</b>
      <b>ō</b>
    </div>
  );
}

/** Skeleton reading lines with a sage guide-highlight gliding along. */
export function ReadingSweep({ className, label, ...props }: SceneProps) {
  return (
    <div className={cn('reading-sweep', className)} {...sceneA11y(label)} {...props}>
      <i></i>
      <i></i>
      <i></i>
    </div>
  );
}
