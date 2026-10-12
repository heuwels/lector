import { WordState } from '@/types';

export const stateFilters: { value: WordState | 'all' | 'learning'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'learning', label: 'Learning' },
  { value: 'new', label: 'New' },
  { value: 'level1', label: 'Level 1' },
  { value: 'level2', label: 'Level 2' },
  { value: 'level3', label: 'Level 3' },
  { value: 'level4', label: 'Level 4' },
  { value: 'level5', label: 'Level 5' },
  { value: 'level6', label: 'Level 6' },
  { value: 'level7', label: 'Level 7' },
  { value: 'known', label: 'Known' },
  { value: 'ignored', label: 'Ignored' },
];

/** Page-size choices offered by the vocab list pagination control. */
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

/** Default rows per page when the user hasn't picked one. */
export const DEFAULT_PAGE_SIZE = 50;

// State sort order for sorting
export const stateOrder: Record<WordState, number> = {
  new: 0,
  level1: 1,
  level2: 2,
  level3: 3,
  level4: 4,
  level5: 5,
  level6: 6,
  level7: 6,
  known: 7,
  ignored: 8,
};
