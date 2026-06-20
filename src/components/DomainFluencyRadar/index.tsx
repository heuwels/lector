'use client';

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { useIsDark } from '@/utils/hooks';
import type { DomainAxis } from '@/lib/data-layer';

interface DomainFluencyRadarProps {
  byDomain?: DomainAxis[];
  pending?: number;
}

// Recharts SVG props don't reliably resolve CSS vars, so use concrete hex
// retinted to the grown-up palette (mirrors VocabGrowthChart/theme.ts). `series`
// is --chart-1 (sage); the Phase-2 exposure overlay will use --chart-2 (clay).
const RADAR_THEME = {
  light: { grid: '#e9e1d0', label: '#6b6356', series: '#2f8a76' },
  dark: { grid: '#352f24', label: '#a99e8a', series: '#54ab92' },
};

interface RadarTooltipProps {
  active?: boolean;
  payload?: { payload: DomainAxis }[];
}

function RadarTooltip({ active, payload }: RadarTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover p-3 shadow-xl">
      <p className="text-sm font-semibold text-foreground">{d.label}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {d.band} · {d.knownCount.toLocaleString()} known {d.knownCount === 1 ? 'word' : 'words'}
      </p>
    </div>
  );
}

/**
 * Radar of a learner's "areas of fluency" — per-domain strength bands derived
 * from the words they know. A learner isn't one CEFR level but many; this shows
 * where they're strong (Cooking) vs developing (Medicine). The polygon plots
 * each axis's 0–100 log-normalised mastery; the real CEFR letter stays global on
 * the fluency card. Empty until the background classifier tags some known words.
 */
export default function DomainFluencyRadar({
  byDomain = [],
  pending = 0,
}: DomainFluencyRadarProps) {
  const isDark = useIsDark();
  const theme = isDark ? RADAR_THEME.dark : RADAR_THEME.light;

  const hasSignal = byDomain.some((d) => d.axisValue > 0);

  return (
    <div className="panel mb-8 p-6" data-testid="domain-fluency-radar">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Areas of Fluency</h3>
          <p className="text-sm text-muted-foreground">Where your vocabulary is strongest</p>
        </div>
        {pending > 0 && (
          <span
            data-testid="domain-radar-pending"
            className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
          >
            {pending.toLocaleString()} {pending === 1 ? 'word' : 'words'} pending classification
          </span>
        )}
      </div>

      {!hasSignal ? (
        <div
          data-testid="domain-radar-empty"
          className="flex min-h-[220px] flex-col items-center justify-center gap-2 text-center"
        >
          <p className="text-sm font-medium text-foreground">No areas mapped yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {pending > 0
              ? 'Your known words are still being sorted into topic areas — check back shortly.'
              : 'Read and learn words to see which topics you’re strongest in.'}
          </p>
        </div>
      ) : (
        <>
          {/* Radar for tablet/desktop. Below ~420px it gets cramped and unreadable,
              so a sorted band list takes over (same data, linear form). */}
          <div data-testid="domain-radar-chart" className="hidden min-[420px]:block">
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={byDomain} margin={{ top: 16, right: 32, bottom: 16, left: 32 }}>
                <PolarGrid stroke={theme.grid} />
                <PolarAngleAxis dataKey="label" tick={{ fill: theme.label, fontSize: 12 }} />
                {/* Fixed 0–100 scale so a small specialised domain can't read "full". */}
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                  name="Mastery"
                  dataKey="axisValue"
                  stroke={theme.series}
                  fill={theme.series}
                  fillOpacity={0.4}
                />
                <Tooltip content={<RadarTooltip />} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Mobile fallback — sorted strongest-first. */}
          <ul data-testid="domain-radar-bandlist" className="space-y-3 min-[420px]:hidden">
            {[...byDomain]
              .sort((a, b) => b.axisValue - a.axisValue)
              .map((d) => (
                <li key={d.domain}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-foreground">{d.label}</span>
                    <span className="text-muted-foreground">
                      {d.band} · {d.knownCount.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${d.axisValue}%`, backgroundColor: theme.series }}
                    />
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}
