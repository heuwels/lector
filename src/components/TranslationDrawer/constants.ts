import { WordState } from "@/types";

export const wordStateColors: Record<WordState, { bg: string; text: string; dot: string; ring: string }> = {
  'new':     { bg: 'bg-blue-100 dark:bg-blue-900/40',     text: 'text-blue-700 dark:text-blue-300',     dot: 'bg-blue-500',   ring: 'ring-blue-500' },
  'level1':  { bg: 'bg-red-100 dark:bg-red-900/40',       text: 'text-red-700 dark:text-red-300',       dot: 'bg-red-500',    ring: 'ring-red-500' },
  'level2':  { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500', ring: 'ring-orange-500' },
  'level3':  { bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-500', ring: 'ring-yellow-500' },
  'level4':  { bg: 'bg-lime-100 dark:bg-lime-900/40',     text: 'text-lime-700 dark:text-lime-300',     dot: 'bg-lime-500',   ring: 'ring-lime-500' },
  'known':   { bg: 'bg-green-100 dark:bg-green-900/40',   text: 'text-green-700 dark:text-green-300',   dot: 'bg-green-500',  ring: 'ring-green-500' },
  'ignored': { bg: 'bg-gray-100 dark:bg-gray-800',        text: 'text-gray-500 dark:text-gray-400',     dot: 'bg-gray-400',   ring: 'ring-gray-400' },
};

export const wordStateLabels: Record<WordState, string> = {
  'new': 'New', 'level1': 'Level 1', 'level2': 'Level 2', 'level3': 'Level 3',
  'level4': 'Level 4', 'known': 'Known', 'ignored': 'Ignored',
};
