import type { ReactNode } from 'react';

export interface StatsCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  highlight?: boolean;
  testId?: string;
}
