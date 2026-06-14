export const correctionTypeLabels: Record<string, { label: string; className: string }> = {
  grammar: { label: 'Grammar', className: 'bg-[var(--clay-soft)] text-clay ' },
  spelling: {
    label: 'Spelling',
    className:
      'bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] text-destructive',
  },
  word_choice: {
    label: 'Word choice',
    className: 'bg-[var(--gold-soft)] text-[var(--gold-strong)]',
  },
  word_order: {
    label: 'Word order',
    className: 'bg-[var(--primary-soft)] text-primary',
  },
  missing_word: { label: 'Missing word', className: 'bg-[var(--gold-soft)] text-[var(--gold-strong)] ' },
  extra_word: { label: 'Extra word', className: 'bg-muted text-muted-foreground' },
};
