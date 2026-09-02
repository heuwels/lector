import type { Theme } from '@/types/theme';
import type { LucideIcon } from 'lucide-react';

export interface IThemeOption {
  value: Theme;
  icon: LucideIcon;
  label: string;
}
