'use client';

import { useIsDark } from '@/utils/hooks';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  AreaChart,
} from 'recharts';
import CustomTooltip from './components/CustomTooltip';
import SummaryStat from './components/SummaryStat';
import { SERIES_COLORS } from './constants';
import { darkChartTheme, lightChartTheme } from './theme';
import type { VocabGrowthChartProps } from './types';
import { formatDisplayDate } from './utils';

export default function VocabGrowthChart({
  data,
  showLegend = true,
  height = 300,
  controls,
}: VocabGrowthChartProps) {
  const isDark = useIsDark();
  const theme = isDark ? darkChartTheme : lightChartTheme;

  const formattedData = data.map((d) => ({
    ...d,
    displayDate: formatDisplayDate(d.date),
  }));

  const latest = data.length > 0 ? data[data.length - 1] : null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Vocabulary Growth</h3>
        {controls}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="knownGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={SERIES_COLORS.known} stopOpacity={0.3} />
              <stop offset="95%" stopColor={SERIES_COLORS.known} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="learningGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={SERIES_COLORS.learning} stopOpacity={0.3} />
              <stop offset="95%" stopColor={SERIES_COLORS.learning} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={SERIES_COLORS.total} stopOpacity={0.3} />
              <stop offset="95%" stopColor={SERIES_COLORS.total} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />

          <XAxis
            dataKey="displayDate"
            stroke={theme.axis}
            fontSize={12}
            tickLine={false}
            axisLine={{ stroke: theme.grid }}
          />

          <YAxis
            stroke={theme.axis}
            fontSize={12}
            tickLine={false}
            axisLine={{ stroke: theme.grid }}
            tickFormatter={(value) => value.toLocaleString()}
          />

          <Tooltip content={<CustomTooltip />} />

          {showLegend && (
            <Legend
              wrapperStyle={{ paddingTop: '20px' }}
              formatter={(value: string) => (
                <span style={{ color: theme.legend }} className="text-sm capitalize">
                  {value}
                </span>
              )}
            />
          )}

          <Area
            type="monotone"
            dataKey="total"
            stroke={SERIES_COLORS.total}
            strokeWidth={2}
            fill="url(#totalGradient)"
            dot={false}
            activeDot={{ r: 4, fill: SERIES_COLORS.total }}
          />
          <Area
            type="monotone"
            dataKey="known"
            stroke={SERIES_COLORS.known}
            strokeWidth={2}
            fill="url(#knownGradient)"
            dot={false}
            activeDot={{ r: 4, fill: SERIES_COLORS.known }}
          />
          <Area
            type="monotone"
            dataKey="learning"
            stroke={SERIES_COLORS.learning}
            strokeWidth={2}
            fill="url(#learningGradient)"
            dot={false}
            activeDot={{ r: 4, fill: SERIES_COLORS.learning }}
          />
        </AreaChart>
      </ResponsiveContainer>

      {latest && (
        <div className="mt-4 grid grid-cols-3 gap-4 border-t border-zinc-200 pt-4 dark:border-slate-800">
          <SummaryStat value={latest.known} label="Known Words" colorClassName="text-green-500" />
          <SummaryStat value={latest.learning} label="Learning" colorClassName="text-yellow-500" />
          <SummaryStat value={latest.total} label="Total" colorClassName="text-blue-500" />
        </div>
      )}
    </div>
  );
}
