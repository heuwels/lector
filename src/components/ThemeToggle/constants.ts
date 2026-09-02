import { Monitor, Sun, Moon } from 'lucide-react';
import { IThemeOption } from './types';

export const OPTIONS: IThemeOption[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
];
