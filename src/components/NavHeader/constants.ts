import {
  JournalIcon,
  LibraryIcon,
  PracticeIcon,
  SettingsIcon,
  StatsIcon,
  VocabIcon,
} from '@/components/icons';

export const navLinks = [
  { href: '/', label: 'Library' },
  { href: '/practice', label: 'Practice' },
  { href: '/journal', label: 'Journal' },
  { href: '/vocab', label: 'Vocab' },
  { href: '/stats', label: 'Stats' },
  { href: '/settings', label: 'Settings' },
];

export const iconMap: Record<string, () => React.ReactElement> = {
  '/': LibraryIcon,
  '/practice': PracticeIcon,
  '/journal': JournalIcon,
  '/vocab': VocabIcon,
  '/stats': StatsIcon,
  '/settings': SettingsIcon,
};
