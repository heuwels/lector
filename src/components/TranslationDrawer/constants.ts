import { WordState } from '@/types';

export const wordStateColors: Record<
  WordState,
  { bg: string; text: string; dot: string; ring: string }
> = {
  new: {
    bg: 'bg-[var(--w-new-bg)]',
    text: 'text-[var(--w-new-fg)]',
    dot: 'bg-[var(--w-new-bd)]',
    ring: 'ring-[var(--w-new-bd)]',
  },
  level1: {
    bg: 'bg-[var(--w-l1-bg)]',
    text: 'text-[var(--w-l1-fg)]',
    dot: 'bg-[var(--w-l1-bd)]',
    ring: 'ring-[var(--w-l1-bd)]',
  },
  level2: {
    bg: 'bg-[var(--w-l2-bg)]',
    text: 'text-[var(--w-l2-fg)]',
    dot: 'bg-[var(--w-l2-bd)]',
    ring: 'ring-[var(--w-l2-bd)]',
  },
  level3: {
    bg: 'bg-[var(--w-l3-bg)]',
    text: 'text-[var(--w-l3-fg)]',
    dot: 'bg-[var(--w-l3-bd)]',
    ring: 'ring-[var(--w-l3-bd)]',
  },
  level4: {
    bg: 'bg-[var(--w-l4-bg)]',
    text: 'text-[var(--w-l4-fg)]',
    dot: 'bg-[var(--w-l4-bd)]',
    ring: 'ring-[var(--w-l4-bd)]',
  },
  level5: {
    bg: 'bg-[var(--w-l5-bg)]',
    text: 'text-[var(--w-l5-fg)]',
    dot: 'bg-[var(--w-l5-bd)]',
    ring: 'ring-[var(--w-l5-bd)]',
  },
  level6: {
    bg: 'bg-[var(--w-l6-bg)]',
    text: 'text-[var(--w-l6-fg)]',
    dot: 'bg-[var(--w-l6-bd)]',
    ring: 'ring-[var(--w-l6-bd)]',
  },
  level7: {
    bg: 'bg-[var(--w-l7-bg)]',
    text: 'text-[var(--w-l7-fg)]',
    dot: 'bg-[var(--w-l7-bd)]',
    ring: 'ring-[var(--w-l7-bd)]',
  },
  known: {
    bg: 'bg-[var(--primary-soft)]',
    text: 'text-[var(--primary-text)]',
    dot: 'bg-primary',
    ring: 'ring-primary',
  },
  ignored: {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
    ring: 'ring-muted-foreground',
  },
};

export const wordStateLabels: Record<WordState, string> = {
  new: 'New',
  level1: 'Level 1',
  level2: 'Level 2',
  level3: 'Level 3',
  level4: 'Level 4',
  level5: 'Level 5',
  level6: 'Level 6',
  level7: 'Level 7',
  known: 'Known',
  ignored: 'Ignored',
};
