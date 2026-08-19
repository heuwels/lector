import { Clipboard, Pencil, List, Library, ChartBar, Settings, Users } from 'lucide-react';

export const navLinks = [
  { href: '/', label: 'Library' },
  { href: '/practice', label: 'Practice' },
  { href: '/journal', label: 'Journal' },
  { href: '/vocab', label: 'Vocab' },
  { href: '/stats', label: 'Statistics' },
  { href: '/settings', label: 'Settings' },
];

/** Cloud-only. Inserted after Library by CommunityNavLink, not this list. */
export const communityNav = { href: '/community', label: 'Community' };

export const iconMap: Record<string, React.FC<{ size?: number | string }>> = {
  '/': Library,
  '/practice': Clipboard,
  '/journal': Pencil,
  '/vocab': List,
  '/stats': ChartBar,
  '/settings': Settings,
  '/community': Users,
};
