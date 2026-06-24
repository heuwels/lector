'use client';

import { useMemo } from 'react';
import { useIsDark } from '@/utils/hooks';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DAYS_OF_WEEK } from './constants';
import { darkColorScheme, lightColorScheme } from './theme';
import { type ActivityHeatmapProps, type ActivityParts, type HeatmapCell } from './types';
import { buildHeatmapGrid, getColor, localEndDate } from './utils';

// The activities that fold into a day's composite count, in display order. Each
// gets a colour dot in the tooltip; `suffix` distinguishes reading (minutes).
const ACTIVITY_TYPES: {
  key: keyof ActivityParts;
  label: string;
  color: string;
  suffix?: string;
}[] = [
  { key: 'dictionaryLookups', label: 'Lookups', color: '#2f8a76' },
  { key: 'clozePracticed', label: 'Cloze', color: '#c0744f' },
  { key: 'minutesRead', label: 'Reading', color: '#cf9a3d', suffix: ' min' },
  { key: 'ankiReviews', label: 'Anki', color: '#8a9a5b' },
];

// "Sat, 14 Jun 2026" — parse the parts so there's no UTC day-shift.
function formatFullDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function DayCell({ day, unit, color }: { day: HeatmapCell; unit: string; color: string }) {
  const rows = day.parts
    ? ACTIVITY_TYPES.map((t) => ({ ...t, value: day.parts![t.key] })).filter((r) => r.value > 0)
    : [];

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            data-testid="heatmap-cell"
            className="h-[12px] w-[12px] rounded-sm transition-colors hover:ring-1 hover:ring-foreground/20"
            style={{ backgroundColor: color }}
          />
        }
      />
      <TooltipContent
        sideOffset={6}
        className="min-w-[172px] flex-col items-stretch gap-1.5 px-3 py-2"
      >
        <div className="font-medium">{formatFullDate(day.date)}</div>
        {day.parts ? (
          rows.length > 0 ? (
            <div className="flex flex-col gap-1">
              {rows.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ backgroundColor: r.color }} />
                    <span className="text-background/75">{r.label}</span>
                  </span>
                  <span className="font-medium tabular-nums">
                    {r.value.toLocaleString()}
                    {r.suffix ?? ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-background/70">No activity</div>
          )
        ) : (
          <div className="text-background/75">
            {day.count.toLocaleString()} {unit}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export default function ActivityHeatmap({
  data,
  unit = 'lookups',
  endDate,
  colorScheme: colorSchemeProp,
}: ActivityHeatmapProps) {
  const isDark = useIsDark();
  const colorScheme = colorSchemeProp || (isDark ? darkColorScheme : lightColorScheme);
  const { weeks, maxCount, monthLabels, totalActivity, activeDays } = useMemo(() => {
    // Color scaling and the headline totals are date-agnostic — just the data.
    const maxCount = Math.max(1, ...data.map((d) => d.count));
    const totalActivity = data.reduce((sum, d) => sum + d.count, 0);
    const activeDays = data.filter((d) => d.count > 0).length;

    // The grid ends on the caller's time-zone-aware "today" (matching the data's
    // date keys), falling back to this device's local date — never UTC (#192).
    const { weeks, monthLabels } = buildHeatmapGrid(data, endDate ?? localEndDate());

    return { weeks, maxCount, monthLabels, totalActivity, activeDays };
  }, [data, endDate]);

  return (
    <TooltipProvider delay={120} closeDelay={0}>
      <div data-testid="activity-heatmap" className="panel p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Activity</h3>
          <div data-testid="activity-heatmap-total" className="text-sm text-muted-foreground">
            {totalActivity.toLocaleString()} {unit} in the last year
          </div>
        </div>

        {/* Month labels */}
        <div className="mb-1 ml-8 grid grid-cols-53">
          {monthLabels
            .filter((month) => month.span > 0)
            .map((month) => (
              <div
                key={`${month.label}-${month.weekIndex}`}
                className="text-xs text-muted-foreground"
                style={{ gridColumn: `span ${month.span}` }}
              >
                {month.label}
              </div>
            ))}
        </div>

        {/* Heatmap grid */}
        <div className="flex">
          {/* Day of week labels */}
          <div className="mr-2 flex flex-col text-xs text-muted-foreground">
            {DAYS_OF_WEEK.map((day, i) => (
              <div
                key={day}
                className="flex h-[12px] items-center"
                style={{ visibility: i % 2 === 1 ? 'visible' : 'hidden' }}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Weeks */}
          <div className="grid flex-1 grid-cols-53">
            {weeks.map((week, weekIdx) => (
              <div key={weekIdx} className="flex flex-col gap-[2px]">
                {week.map((day) => (
                  <DayCell
                    key={day.date}
                    day={day}
                    unit={unit}
                    color={getColor(day.count, maxCount, colorScheme)}
                  />
                ))}
                {/* Fill empty days for incomplete weeks */}
                {week.length < 7 &&
                  Array(7 - week.length)
                    .fill(null)
                    .map((_, i) => <div key={`empty-${i}`} className="h-[12px] w-[12px]" />)}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>Less</span>
          <div className="flex gap-[2px]">
            <div
              className="h-[12px] w-[12px] rounded-sm"
              style={{ backgroundColor: colorScheme.empty }}
            />
            <div
              className="h-[12px] w-[12px] rounded-sm"
              style={{ backgroundColor: colorScheme.level1 }}
            />
            <div
              className="h-[12px] w-[12px] rounded-sm"
              style={{ backgroundColor: colorScheme.level2 }}
            />
            <div
              className="h-[12px] w-[12px] rounded-sm"
              style={{ backgroundColor: colorScheme.level3 }}
            />
            <div
              className="h-[12px] w-[12px] rounded-sm"
              style={{ backgroundColor: colorScheme.level4 }}
            />
          </div>
          <span>More</span>
        </div>

        {/* Stats row */}
        <div className="mt-4 flex gap-6 border-t border-border pt-4">
          <div className="text-sm">
            <span className="text-muted-foreground">Active days: </span>
            <span className="font-medium text-foreground">{activeDays}</span>
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Avg per active day: </span>
            <span className="font-medium text-foreground">
              {activeDays > 0 ? Math.round(totalActivity / activeDays).toLocaleString() : 0}
            </span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
