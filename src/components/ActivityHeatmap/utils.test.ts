import { describe, it, expect } from 'vitest';
import { buildHeatmapGrid, getColor, localEndDate } from './utils';
import { darkColorScheme } from './theme';
import type { ActivityDay, HeatmapCell } from './types';

const flat = (weeks: HeatmapCell[][]): HeatmapCell[] => weeks.flat();

describe('buildHeatmapGrid', () => {
  // 2026-06-24 is a Wednesday — verified independently via Date.UTC below so
  // the weekday assertions don't just re-run the function's own logic.
  const END = '2026-06-24';

  it('renders today as the final cell, with its activity (issue #192)', () => {
    // The data row for "today" is keyed by the configured-time-zone calendar
    // date. In the morning for a zone ahead of UTC, the old grid ended on the
    // UTC date (yesterday), so this row had no cell and today was dropped.
    const data: ActivityDay[] = [
      {
        date: END,
        count: 7,
        parts: { dictionaryLookups: 3, clozePracticed: 4, minutesRead: 0, ankiReviews: 0 },
      },
    ];

    const { weeks } = buildHeatmapGrid(data, END);
    const cells = flat(weeks);
    const last = cells[cells.length - 1];

    expect(last.date).toBe(END);
    expect(last.count).toBe(7);
    expect(last.parts).toEqual(data[0].parts);
    // Nothing is rendered past today.
    expect(cells.every((c) => c.date <= END)).toBe(true);
  });

  it('keys cells by calendar date with no UTC shift (correct weekday)', () => {
    const { weeks } = buildHeatmapGrid([], END);
    const cells = flat(weeks);

    const todayCell = cells.find((c) => c.date === END)!;
    expect(todayCell).toBeDefined();
    // Independent weekday source: 0=Sun … 3=Wed.
    expect(todayCell.dayOfWeek).toBe(new Date(Date.UTC(2026, 5, 24)).getUTCDay());
    expect(todayCell.dayOfWeek).toBe(3);
  });

  it('starts the grid on a Sunday and spans exactly 53 weeks', () => {
    const { weeks } = buildHeatmapGrid([], END);

    expect(weeks).toHaveLength(53);
    expect(weeks[0][0].dayOfWeek).toBe(0); // Sunday
    // 365-day window: first cell is 364 days before today, padded back to Sunday.
    expect(weeks[0][0].date <= '2025-06-25').toBe(true);
    expect(weeks[0][0].date >= '2025-06-19').toBe(true);
  });

  it('walks consecutive calendar days within and across weeks (DST-safe)', () => {
    const { weeks } = buildHeatmapGrid([], END);
    const cells = flat(weeks);

    // Every step is exactly one calendar day and the weekday cycles 0..6.
    for (let i = 1; i < cells.length; i++) {
      const prev = new Date(cells[i - 1].date + 'T12:00:00Z');
      const cur = new Date(cells[i].date + 'T12:00:00Z');
      expect((cur.getTime() - prev.getTime()) / 86_400_000).toBe(1);
      expect(cells[i].dayOfWeek).toBe((cells[i - 1].dayOfWeek + 1) % 7);
    }
  });

  it('zero-fills days with no activity record', () => {
    const { weeks } = buildHeatmapGrid([{ date: END, count: 2 }], END);
    const cells = flat(weeks);
    const someEarlier = cells[10];
    expect(someEarlier.count).toBe(0);
    expect(someEarlier.parts).toBeUndefined();
  });

  it('produces month labels whose spans tile the full 53-column grid', () => {
    const { weeks, monthLabels } = buildHeatmapGrid([], END);
    const totalSpan = monthLabels.reduce((sum, m) => sum + m.span, 0);
    expect(totalSpan).toBe(weeks.length);
    expect(monthLabels[0].label).toMatch(/^[A-Z][a-z]{2}$/);
  });
});

describe('localEndDate', () => {
  it('returns a YYYY-MM-DD string (never an empty/UTC-only value)', () => {
    expect(localEndDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getColor', () => {
  it('returns the empty color at zero and scales up with the ratio', () => {
    expect(getColor(0, 10, darkColorScheme)).toBe(darkColorScheme.empty);
    expect(getColor(2, 10, darkColorScheme)).toBe(darkColorScheme.level1);
    expect(getColor(10, 10, darkColorScheme)).toBe(darkColorScheme.level4);
  });
});
