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
  /**
   * Today's calendar date (YYYY-MM-DD) in the user's configured time zone — the
   * last cell the grid renders. Must be derived the same way as the data's date
   * keys (timezone-aware, never UTC) or today's column is dropped in the morning
   * for zones ahead of UTC (issue #192). Falls back to the device's local date.
   */
  endDate?: string;
  colorScheme?: {
    empty: string;
    level1: string;
    level2: string;
    level3: string;
    level4: string;
  };
}

/** One rendered grid cell: a calendar date (YYYY-MM-DD) and its activity. */
export interface HeatmapCell {
  date: string;
  count: number;
  dayOfWeek: number;
  parts?: ActivityParts;
}

/** A month name anchored at the grid column where that month first appears. */
export interface MonthLabel {
  label: string;
  weekIndex: number;
  span: number;
}
