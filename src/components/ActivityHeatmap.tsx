'use client';

import { useMemo, useState, useEffect } from 'react';

interface ActivityDay {
  date: string; // YYYY-MM-DD
  count: number;
}

interface ActivityHeatmapProps {
  data: ActivityDay[];
  colorScheme?: {
    empty: string;
    level1: string;
    level2: string;
    level3: string;
    level4: string;
  };
}

const darkColorScheme = {
  empty: '#1e293b',    // slate-800
  level1: '#166534',   // green-800
  level2: '#22c55e',   // green-500
  level3: '#4ade80',   // green-400
  level4: '#86efac',   // green-300
};

const lightColorScheme = {
  empty: '#e2e8f0',    // slate-200
  level1: '#bbf7d0',   // green-200
  level2: '#4ade80',   // green-400
  level3: '#22c55e',   // green-500
  level4: '#16a34a',   // green-600
};

function useIsDark() {
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

const defaultColorScheme = darkColorScheme;

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getColor(count: number, maxCount: number, scheme: typeof defaultColorScheme): string {
  if (count === 0) return scheme.empty;
  const ratio = count / maxCount;
  if (ratio <= 0.25) return scheme.level1;
  if (ratio <= 0.5) return scheme.level2;
  if (ratio <= 0.75) return scheme.level3;
  return scheme.level4;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

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
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Activity</h3>
        <div className="text-sm text-zinc-500 dark:text-slate-400">
          {totalActivity.toLocaleString()} words in the last year
        </div>
      </div>

      {/* Month labels */}
      <div className="flex ml-8 mb-1">
        {monthLabels.map((month, i) => (
          <div
            key={i}
            className="text-xs text-zinc-400 dark:text-slate-500"
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
        <div className="flex flex-col mr-2 text-xs text-zinc-400 dark:text-slate-500">
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
              {week.map((day, dayIdx) => (
                <div
                  key={day.date}
                  className="w-[12px] h-[12px] rounded-sm transition-colors hover:ring-1 hover:ring-black/20 dark:hover:ring-white/30"
                  style={{ backgroundColor: getColor(day.count, maxCount, colorScheme) }}
                  title={`${day.date}: ${day.count} words read`}
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
      <div className="flex items-center justify-end mt-4 gap-2 text-xs text-zinc-400 dark:text-slate-500">
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
      <div className="flex gap-6 mt-4 pt-4 border-t border-zinc-200 dark:border-slate-800">
        <div className="text-sm">
          <span className="text-zinc-500 dark:text-slate-400">Active days: </span>
          <span className="text-zinc-900 dark:text-white font-medium">{activeDays}</span>
        </div>
        <div className="text-sm">
          <span className="text-zinc-500 dark:text-slate-400">Avg per active day: </span>
          <span className="text-zinc-900 dark:text-white font-medium">
            {activeDays > 0 ? Math.round(totalActivity / activeDays).toLocaleString() : 0}
          </span>
        </div>
      </div>
    </div>
  );
}
