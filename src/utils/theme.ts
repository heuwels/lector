import { Theme } from "@/types/theme";

export function getEffectiveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  const effective = getEffectiveTheme(theme);
  document.documentElement.classList.toggle('dark', effective === 'dark');
}