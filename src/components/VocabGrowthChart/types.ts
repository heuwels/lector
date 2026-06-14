import type { ReactNode } from 'react';

export interface VocabDataPoint {
  date: string;
  known: number;
  learning: number;
  total: number;
}

export interface VocabGrowthChartProps {
  data: VocabDataPoint[];
  showLegend?: boolean;
  height?: number;
  /** Optional controls rendered in the card header, e.g. a time-range selector. */
  controls?: ReactNode;
}
