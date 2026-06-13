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
}
