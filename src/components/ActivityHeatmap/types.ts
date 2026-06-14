
export interface ActivityParts {
  dictionaryLookups: number;
  clozePracticed: number;
  minutesRead: number;
  ankiReviews: number;
}

export interface ActivityDay {
  date: string; // YYYY-MM-DD
  count: number;
  // Per-activity breakdown for the hover tooltip. Optional so callers that only
  // have a composite count still type-check; the sum should equal `count`.
  parts?: ActivityParts;
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