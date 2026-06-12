export const correctionTypeLabels: Record<string, { label: string; className: string }> = {
  grammar: { label: 'Grammar', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
  spelling: { label: 'Spelling', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  word_choice: { label: 'Word choice', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  word_order: { label: 'Word order', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  missing_word: { label: 'Missing word', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  extra_word: { label: 'Extra word', className: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300' },
};