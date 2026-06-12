
export interface ActivityDay {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface ActivityHeatmapProps {
  data: ActivityDay[];
  colorScheme?: {
    empty: string;
    level1: string;
    level2: string;
    level3: string;
    level4: string;
  };
}