'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useIsDark } from '@/utils/hooks';
import { buttonVariants } from '@/components/ui/button';
import { darkChartTheme, lightChartTheme } from '@/components/VocabGrowthChart/theme';
import { formatDisplayDate } from '@/components/VocabGrowthChart/utils';

export interface AnkiReviewPoint {
  date: string;
  reviews: number;
}

// blue-500 — matches the app's primary accent used elsewhere on the stats page.
const ANKI_COLOR = '#2f8a76';

// Distinct sequential dates across ~3 months (31 + 28 + 31 = 90) so the blurred
// preview chart spans the full width like the real one.
function previewDate(i: number): string {
  const months: [string, number][] = [
    ['01', 31],
    ['02', 28],
    ['03', 31],
  ];
  let day = i;
  for (const [m, len] of months) {
    if (day < len) return `2026-${m}-${String(day + 1).padStart(2, '0')}`;
    day -= len;
  }
  return '2026-03-31';
}

// Deterministic sample curve for the disconnected preview (no Math.random — it
// must be stable across renders so the blurred placeholder reads as a real
// "this is what your review history will look like" teaser).
const PREVIEW_DATA: AnkiReviewPoint[] = Array.from({ length: 90 }, (_, i) => ({
  date: previewDate(i),
  reviews: Math.round(28 + 32 * Math.abs(Math.sin(i / 4)) + (i % 6) * 5),
}));

function ReviewsAreaChart({ data, height = 240 }: { data: AnkiReviewPoint[]; height?: number }) {
  const isDark = useIsDark();
  const theme = isDark ? darkChartTheme : lightChartTheme;
  const formatted = data.map((d) => ({ ...d, displayDate: formatDisplayDate(d.date) }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={formatted} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="ankiReviewsGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={ANKI_COLOR} stopOpacity={0.35} />
            <stop offset="95%" stopColor={ANKI_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
        <XAxis
          dataKey="displayDate"
          stroke={theme.axis}
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: theme.grid }}
          minTickGap={24}
        />
        <YAxis
          stroke={theme.axis}
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: theme.grid }}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: theme.grid }}
          contentStyle={{
            borderRadius: 8,
            border: `1px solid ${theme.grid}`,
            background: isDark ? '#211d16' : '#fffdf7',
            color: isDark ? '#ece5d6' : '#2c2a23',
            fontSize: 12,
          }}
          formatter={(value: number | undefined) =>
            [(value ?? 0).toLocaleString(), 'Reviews'] as [string, string]
          }
        />
        <Area
          type="monotone"
          dataKey="reviews"
          stroke={ANKI_COLOR}
          strokeWidth={2}
          fill="url(#ankiReviewsGradient)"
          dot={false}
          activeDot={{ r: 4, fill: ANKI_COLOR }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Stat({ value, label, className }: { value: number; label: string; className: string }) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${className}`}>{value.toLocaleString()}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * Anki review-history chart. Two states:
 *  - hasData: the real reviews/day area chart + summary, from synced
 *    dailyStats.ankiReviews (works offline — it renders the last sync).
 *  - !hasData (never connected): the same chart blurred behind a "Connect your
 *    Anki" call-to-action, so the user previews exactly what they'll unlock.
 *
 * `hasData` is decided by the caller from full history (not the visible window),
 * so a user who has connected before keeps their chart even after a quiet spell.
 */
export default function AnkiReviewsChart({
  data,
  hasData,
}: {
  data: AnkiReviewPoint[];
  hasData: boolean;
}) {
  const total = data.reduce((sum, d) => sum + d.reviews, 0);
  const reviewDays = data.filter((d) => d.reviews > 0).length;
  const perDay = reviewDays > 0 ? Math.round(total / reviewDays) : 0;

  return (
    <div
      data-testid="anki-reviews-card"
      className="panel p-6"
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-foreground">Anki Reviews</h3>
        {hasData && (
          <span className="text-sm text-muted-foreground">Last 90 days</span>
        )}
      </div>

      {hasData ? (
        <div data-testid="anki-reviews-chart">
          <ReviewsAreaChart data={data} />
          <div className="mt-4 grid grid-cols-3 gap-4 border-t border-border pt-4">
            <Stat value={total} label="Reviews" className="text-primary" />
            <Stat value={reviewDays} label="Review days" className="text-[var(--gold-strong)]" />
            <Stat value={perDay} label="Avg / review day" className="text-clay" />
          </div>
        </div>
      ) : (
        <div data-testid="anki-reviews-preview" className="relative">
          {/* Blurred preview of the real chart — shows what connecting unlocks. */}
          <div aria-hidden className="pointer-events-none select-none blur-[3px] opacity-50">
            <ReviewsAreaChart data={PREVIEW_DATA} />
          </div>
          {/* Connect-your-Anki overlay */}
          <div className="absolute inset-0 flex items-center justify-center px-4">
            <div className="max-w-xs rounded-2xl border border-border/70 bg-card/80 px-6 py-5 text-center shadow-sm backdrop-blur-sm">
              <div className="mb-2 flex justify-center text-primary">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-foreground">
                Connect your Anki to see your review history
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Reviews sync automatically and count toward your streak.
              </p>
              <Link href="/settings" className={`${buttonVariants({ size: 'sm' })} mt-3`}>
                Connect Anki
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
