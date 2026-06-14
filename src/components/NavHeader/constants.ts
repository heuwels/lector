import { Clipboard, Pencil, List, Library, ChartBar, Settings } from 'lucide-react';

export const navLinks = [
  { href: '/', label: 'Library' },
  { href: '/practice', label: 'Cloze' },
  { href: '/journal', label: 'Journal' },
  { href: '/vocab', label: 'Vocab' },
  { href: '/stats', label: 'Statistics' },
  { href: '/settings', label: 'Settings' },
];

export const iconMap: Record<string, React.FC<{ size?: number | string }>> = {
  '/': Library,
  '/practice': Clipboard,
  '/journal': Pencil,
  '/vocab': List,
  '/stats': ChartBar,
  '/settings': Settings,
};
