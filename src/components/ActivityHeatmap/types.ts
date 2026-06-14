
export interface ActivityDay {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface ActivityHeatmapProps {
  data: ActivityDay[];
  /** Noun for the counted unit, e.g. "actions" or "lookups". Defaults to "lookups". */
  unit?: string;
  colorScheme?: {
    empty: string;
    level1: string;
    level2: string;
    level3: string;
    level4: string;
  };
}