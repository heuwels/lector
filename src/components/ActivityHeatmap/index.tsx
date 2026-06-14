'use client';

import { useMemo, } from 'react';
import { useIsDark } from '@/utils/hooks';
import { DAYS_OF_WEEK, MONTHS } from './constants';
import { darkColorScheme, lightColorScheme } from './theme';
import { type ActivityHeatmapProps } from './types'
import { formatDate, getColor } from './utils';

export default function ActivityHeatmap({
  data,
  colorScheme: colorSchemeProp,
}: ActivityHeatmapProps) {
  const isDark = useIsDark();
  const colorScheme = colorSchemeProp || (isDark ? darkColorScheme : lightColorScheme);
  const { weeks, maxCount, monthLabels, totalActivity, activeDays } = useMemo(() => {
    // Create a map of date -> count
    const activityMap = new Map(data.map(d => [d.date, d.count]));

    // Calculate max count for color scaling
    const maxCount = Math.max(1, ...data.map(d => d.count));

    // Generate 365 days ending today
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 364);

    // Adjust start to be a Sunday
    const startDayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - startDayOfWeek);

    const weeks: Array<Array<{ date: string; count: number; dayOfWeek: number }>> = [];
    let currentWeek: Array<{ date: string; count: number; dayOfWeek: number }> = [];

    const monthLabels: Array<{ label: string; weekIndex: number }> = [];
    let lastMonth = -1;

    const currentDate = new Date(startDate);
    let weekIndex = 0;

    while (currentDate <= today) {
      const dateStr = formatDate(currentDate);
      const count = activityMap.get(dateStr) || 0;
      const month = currentDate.getMonth();
      const dayOfWeek = currentDate.getDay();

      // Track month changes for labels
      if (month !== lastMonth && dayOfWeek === 0) {
        monthLabels.push({ label: MONTHS[month], weekIndex });
        lastMonth = month;
      }

      currentWeek.push({ date: dateStr, count, dayOfWeek });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
        weekIndex++;
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Push remaining days
    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    // Calculate totals
    const totalActivity = data.reduce((sum, d) => sum + d.count, 0);
    const activeDays = data.filter(d => d.count > 0).length;

    return { weeks, maxCount, monthLabels, totalActivity, activeDays };
  }, [data]);

  return (
    <div data-testid="activity-heatmap" className="panel p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Activity</h3>
        <div data-testid="activity-heatmap-total" className="text-sm text-muted-foreground">
          {totalActivity.toLocaleString()} lookups in the last year
        </div>
      </div>

      {/* Month labels */}
      <div className="flex ml-8 mb-1">
        {monthLabels.map((month, i) => (
          <div
            key={i}
            className="text-xs text-muted-foreground"
            style={{
              position: 'relative',
              left: `${month.weekIndex * 14}px`,
              marginRight: '-8px'
            }}
          >
            {month.label}
          </div>
        ))}
      </div>

      {/* Heatmap grid */}
      <div className="flex">
        {/* Day of week labels */}
        <div className="flex flex-col mr-2 text-xs text-muted-foreground">
          {DAYS_OF_WEEK.map((day, i) => (
            <div
              key={day}
              className="h-[12px] flex items-center"
              style={{ visibility: i % 2 === 1 ? 'visible' : 'hidden' }}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Weeks */}
        <div className="flex gap-[2px]">
          {weeks.map((week, weekIdx) => (
            <div key={weekIdx} className="flex flex-col gap-[2px]">
              {week.map((day) => (
                <div
                  key={day.date}
                  className="w-[12px] h-[12px] rounded-sm transition-colors hover:ring-1 hover:ring-foreground/20"
                  style={{ backgroundColor: getColor(day.count, maxCount, colorScheme) }}
                  title={`${day.date}: ${day.count} lookups`}
                />
              ))}
              {/* Fill empty days for incomplete weeks */}
              {week.length < 7 && Array(7 - week.length).fill(null).map((_, i) => (
                <div key={`empty-${i}`} className="w-[12px] h-[12px]" />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end mt-4 gap-2 text-xs text-muted-foreground">
        <span>Less</span>
        <div className="flex gap-[2px]">
          <div
            className="w-[12px] h-[12px] rounded-sm"
            style={{ backgroundColor: colorScheme.empty }}
          />
          <div
            className="w-[12px] h-[12px] rounded-sm"
            style={{ backgroundColor: colorScheme.level1 }}
          />
          <div
            className="w-[12px] h-[12px] rounded-sm"
            style={{ backgroundColor: colorScheme.level2 }}
          />
          <div
            className="w-[12px] h-[12px] rounded-sm"
            style={{ backgroundColor: colorScheme.level3 }}
          />
          <div
            className="w-[12px] h-[12px] rounded-sm"
            style={{ backgroundColor: colorScheme.level4 }}
          />
        </div>
        <span>More</span>
      </div>

      {/* Stats row */}
      <div className="flex gap-6 mt-4 pt-4 border-t border-border">
        <div className="text-sm">
          <span className="text-muted-foreground">Active days: </span>
          <span className="text-foreground font-medium">{activeDays}</span>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Avg per active day: </span>
          <span className="text-foreground font-medium">
            {activeDays > 0 ? Math.round(totalActivity / activeDays).toLocaleString() : 0}
          </span>
        </div>
      </div>
    </div>
  );
}
