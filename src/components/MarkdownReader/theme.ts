import { WordState } from "@/types";

// One token-class map for both light and dark — the --w-* word-state tokens flip
// under `.dark` (issue #147 §4.3), so a single map covers both modes. A single
// warm ochre ramp (level1 deepest -> level4 faintest) plus a calm slate for
// `new`. `known` renders as plain text (no chip); `ignored` is dimmed. Chip
// shape and weight are applied at the render site in MarkdownReader.
export const stateClasses: Record<WordState, string> = {
    new: 'bg-[var(--w-new-bg)] text-[var(--w-new-fg)] border border-[var(--w-new-bd)]',
    level1: 'bg-[var(--w-l1-bg)] text-[var(--w-l1-fg)] border border-[var(--w-l1-bd)]',
    level2: 'bg-[var(--w-l2-bg)] text-[var(--w-l2-fg)] border border-[var(--w-l2-bd)]',
    level3: 'bg-[var(--w-l3-bg)] text-[var(--w-l3-fg)] border border-[var(--w-l3-bd)]',
    level4: 'bg-[var(--w-l4-bg)] text-[var(--w-l4-fg)] border border-[var(--w-l4-bd)]',
    known: '',
    ignored: 'opacity-60 text-muted-foreground',
};
