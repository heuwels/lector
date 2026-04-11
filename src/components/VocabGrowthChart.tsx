'use client';

import { useState, useEffect } from 'react';
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

interface VocabDataPoint {
  date: string;
  known: number;
  learning: number;
  total: number;
}

interface VocabGrowthChartProps {
  data: VocabDataPoint[];
  showLegend?: boolean;
  height?: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    dataKey: string;
    color: string;
  }>;
  label?: string;
}

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

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-white dark:bg-slate-800 border border-zinc-200 dark:border-slate-700 rounded-lg p-3 shadow-xl">
      <p className="text-zinc-500 dark:text-slate-400 text-sm mb-2">{label}</p>
      {payload.map((entry, index) => (
        <p key={index} className="text-sm" style={{ color: entry.color }}>
          <span className="capitalize">{entry.dataKey}: </span>
          <span className="font-semibold">{entry.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

export default function VocabGrowthChart({
  data,
  showLegend = true,
  height = 300,
}: VocabGrowthChartProps) {
  const isDark = useIsDark();

  const gridColor = isDark ? '#334155' : '#e2e8f0';
  const axisColor = isDark ? '#64748b' : '#94a3b8';
  const legendColor = isDark ? '#cbd5e1' : '#475569';

  const formattedData = data.map(d => ({
    ...d,
    displayDate: new Date(d.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    }),
  }));

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">Vocabulary Growth</h3>

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="knownGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="learningGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />

          <XAxis
            dataKey="displayDate"
            stroke={axisColor}
            fontSize={12}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
          />

          <YAxis
            stroke={axisColor}
            fontSize={12}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            tickFormatter={(value) => value.toLocaleString()}
          />

          <Tooltip content={<CustomTooltip />} />

          {showLegend && (
            <Legend
              wrapperStyle={{ paddingTop: '20px' }}
              formatter={(value: string) => (
                <span style={{ color: legendColor }} className="text-sm capitalize">{value}</span>
              )}
            />
          )}

          <Area type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} fill="url(#totalGradient)" dot={false} activeDot={{ r: 4, fill: '#3b82f6' }} />
          <Area type="monotone" dataKey="known" stroke="#22c55e" strokeWidth={2} fill="url(#knownGradient)" dot={false} activeDot={{ r: 4, fill: '#22c55e' }} />
          <Area type="monotone" dataKey="learning" stroke="#eab308" strokeWidth={2} fill="url(#learningGradient)" dot={false} activeDot={{ r: 4, fill: '#eab308' }} />
        </AreaChart>
      </ResponsiveContainer>

      {data.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-zinc-200 dark:border-slate-800">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-500">{data[data.length - 1].known.toLocaleString()}</div>
            <div className="text-xs text-zinc-500 dark:text-slate-400">Known Words</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-500">{data[data.length - 1].learning.toLocaleString()}</div>
            <div className="text-xs text-zinc-500 dark:text-slate-400">Learning</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-500">{data[data.length - 1].total.toLocaleString()}</div>
            <div className="text-xs text-zinc-500 dark:text-slate-400">Total</div>
          </div>
        </div>
      )}
    </div>
  );
}
