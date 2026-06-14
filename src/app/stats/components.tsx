import { ChevronDown, ChevronUp } from 'lucide-react';
import NavHeader from '@/components/NavHeader';
import { ClozeCollection, FluencyStats, WordState } from '@/lib/data-layer';

// Stat card component
export function StatCard({
  label,
  value,
  sublabel,
  icon,
  color = 'blue',
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: React.ReactNode;
  color?: 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink';
}) {
  const textColors = {
    blue: 'text-blue-600 dark:text-blue-400',
    green: 'text-green-600 dark:text-green-400',
    yellow: 'text-yellow-600 dark:text-yellow-400',
    purple: 'text-purple-600 dark:text-purple-400',
    orange: 'text-orange-600 dark:text-orange-400',
    pink: 'text-pink-600 dark:text-pink-400',
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 transition-transform hover:scale-[1.02] dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
          <p className={`mt-1 text-4xl font-bold ${textColors[color]}`}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {sublabel && <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">{sublabel}</p>}
        </div>
        {icon && <div className={`${textColors[color]} opacity-60`}>{icon}</div>}
      </div>
    </div>
  );
}

// Word state breakdown component
export function WordStateBreakdown({ byState }: { byState: Record<WordState, number> }) {
  const states: { key: WordState; label: string; color: string; bgColor: string }[] = [
    {
      key: 'known',
      label: 'Known',
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-500',
    },
    {
      key: 'level4',
      label: 'Level 4',
      color: 'text-green-500 dark:text-green-300',
      bgColor: 'bg-green-400',
    },
    {
      key: 'level3',
      label: 'Level 3',
      color: 'text-yellow-500 dark:text-yellow-300',
      bgColor: 'bg-yellow-400',
    },
    {
      key: 'level2',
      label: 'Level 2',
      color: 'text-yellow-600 dark:text-yellow-400',
      bgColor: 'bg-yellow-500',
    },
    {
      key: 'level1',
      label: 'Level 1',
      color: 'text-orange-600 dark:text-orange-400',
      bgColor: 'bg-orange-500',
    },
    { key: 'new', label: 'New', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-500' },
    {
      key: 'ignored',
      label: 'Ignored',
      color: 'text-zinc-500 dark:text-zinc-400',
      bgColor: 'bg-zinc-400 dark:bg-zinc-500',
    },
  ];

  const total = Object.values(byState).reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Words by State
      </h3>
      <div className="space-y-3">
        {states.map(({ key, label, color, bgColor }) => {
          const count = byState[key] || 0;
          const percentage = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={key}>
              <div className="mb-1 flex justify-between text-sm">
                <span className={color}>{label}</span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {count.toLocaleString()} ({percentage.toFixed(1)}%)
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className={`h-full ${bgColor} rounded-full transition-all duration-500`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Cloze stats component
export function ClozeStats({
  attempts,
  correct,
  points,
}: {
  attempts: number;
  correct: number;
  points: number;
}) {
  const accuracy = attempts > 0 ? (correct / attempts) * 100 : 0;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Cloze Practice
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-zinc-100 p-4 text-center dark:bg-zinc-800/50">
          <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">
            {attempts.toLocaleString()}
          </div>
          <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Sentences Practiced</div>
        </div>
        <div className="rounded-lg bg-zinc-100 p-4 text-center dark:bg-zinc-800/50">
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">
            {accuracy.toFixed(1)}%
          </div>
          <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Accuracy</div>
        </div>
        <div className="col-span-2 rounded-lg bg-zinc-100 p-4 text-center dark:bg-zinc-800/50">
          <div className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">
            {points.toLocaleString()}
          </div>
          <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Total Points</div>
        </div>
      </div>
    </div>
  );
}

// Sentence mastery component
export function SentenceMastery({
  collectionCounts,
}: {
  collectionCounts: Record<ClozeCollection, { total: number; due: number; mastered: number }>;
}) {
  const collectionLabels: Record<string, string> = {
    top500: 'Top 500',
    top1000: 'Top 1000',
    top2000: 'Top 2000',
    mined: 'Mined',
    random: 'Random',
  };

  const collections = Object.entries(collectionCounts).filter(([, counts]) => counts.total > 0);

  const overallTotal = collections.reduce((sum, [, c]) => sum + c.total, 0);
  const overallMastered = collections.reduce((sum, [, c]) => sum + c.mastered, 0);
  const overallPercentage = overallTotal > 0 ? (overallMastered / overallTotal) * 100 : 0;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Sentence Mastery</h3>
        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
          {overallPercentage.toFixed(1)}% overall
        </span>
      </div>

      {/* Overall progress bar */}
      <div className="mb-6">
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">
            {overallMastered.toLocaleString()} / {overallTotal.toLocaleString()} mastered
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${overallPercentage}%` }}
          />
        </div>
      </div>

      {/* Per-collection breakdown */}
      <div className="space-y-4">
        {collections.map(([collection, counts]) => {
          const pct = counts.total > 0 ? (counts.mastered / counts.total) * 100 : 0;
          return (
            <div key={collection}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {collectionLabels[collection] || collection}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {counts.mastered} / {counts.total} ({pct.toFixed(0)}%)
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500/80 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {counts.due > 0 && (
                <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                  {counts.due} due for review
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Fluency badge component
export function FluencyBadge({ fluency }: { fluency: FluencyStats }) {
  const { estimatedLevel, progressToNextLevel, totalKnownWords, totalLearning, weeklyGrowth } =
    fluency;
  const growthDelta = weeklyGrowth.delta;

  return (
    <div
      data-testid="fluency-section"
      className="mb-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span
            data-testid="fluency-level-badge"
            className="inline-flex items-center rounded-lg bg-blue-100 px-4 py-2 text-lg font-bold text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
          >
            {estimatedLevel.code}
          </span>
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {estimatedLevel.code} &mdash; {estimatedLevel.label}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Estimated CEFR Level</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {growthDelta !== 0 && (
            <span
              data-testid="fluency-weekly-growth"
              className={`inline-flex items-center gap-1 text-sm font-medium ${
                growthDelta > 0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-500 dark:text-red-400'
              }`}
            >
              {growthDelta > 0 ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              {Math.abs(growthDelta)} vs last week
            </span>
          )}
          {growthDelta === 0 && weeklyGrowth.thisWeek > 0 && (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {weeklyGrowth.thisWeek} this week (same as last)
            </span>
          )}
        </div>
      </div>

      {/* Progress bar toward next level */}
      <div className="mb-4">
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Progress to next level</span>
          <span className="text-zinc-500 dark:text-zinc-400">{progressToNextLevel}%</span>
        </div>
        <div
          data-testid="fluency-progress-bar"
          className="h-3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        >
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${progressToNextLevel}%` }}
          />
        </div>
      </div>

      {/* Known / Learning counts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-zinc-100 p-3 text-center dark:bg-zinc-800/50">
          <div
            data-testid="fluency-known-count"
            className="text-2xl font-bold text-green-600 dark:text-green-400"
          >
            {totalKnownWords.toLocaleString()}
          </div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">Known</div>
        </div>
        <div className="rounded-lg bg-zinc-100 p-3 text-center dark:bg-zinc-800/50">
          <div
            data-testid="fluency-learning-count"
            className="text-2xl font-bold text-yellow-600 dark:text-yellow-400"
          >
            {totalLearning.toLocaleString()}
          </div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">Learning</div>
        </div>
      </div>
    </div>
  );
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-zinc-200 dark:bg-zinc-800 ${className}`} />;
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <SkeletonBlock className="mb-3 h-4 w-24" />
      <SkeletonBlock className="mb-2 h-10 w-32" />
      <SkeletonBlock className="h-3 w-20" />
    </div>
  );
}

export function StatsSkeleton() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-8" data-testid="stats-skeleton">
      <SkeletonBlock className="mb-6 h-4 w-56" />

      {/* Fluency badge skeleton */}
      <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex items-center gap-4">
          <SkeletonBlock className="h-10 w-16" />
          <div className="flex-1">
            <SkeletonBlock className="mb-2 h-5 w-48" />
            <SkeletonBlock className="h-4 w-32" />
          </div>
        </div>
        <SkeletonBlock className="mb-4 h-3 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <SkeletonBlock className="h-16" />
          <SkeletonBlock className="h-16" />
        </div>
      </div>

      {/* Top stat cards skeleton */}
      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>

      {/* Vocab growth chart skeleton */}
      <SkeletonBlock className="mb-8 h-72" />

      {/* Activity heatmap skeleton */}
      <SkeletonBlock className="mb-8 h-56" />

      {/* Detailed breakdowns skeleton */}
      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <SkeletonBlock className="h-72" />
        <SkeletonBlock className="h-72" />
      </div>

      {/* Sentence mastery skeleton */}
      <SkeletonBlock className="h-64" />
    </main>
  );
}
