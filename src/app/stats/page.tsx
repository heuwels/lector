'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getVocabStats,
  getAllBooks,
  getStatsForDateRange,
  getAllClozeSentences,
  getCollectionCounts,
  type DailyStats,
  type WordState,
  type ClozeCollection,
} from '@/lib/data-layer';
import ActivityHeatmap from '@/components/ActivityHeatmap';
import VocabGrowthChart from '@/components/VocabGrowthChart';

interface StatsData {
  totalKnown: number;
  totalLearning: number;
  totalWords: number;
  byState: Record<WordState, number>;
  currentStreak: number;
  longestStreak: number;
  booksRead: number;
  totalBooks: number;
  totalReadingMinutes: number;
  totalClozeAttempts: number;
  totalClozeCorrect: number;
  totalPoints: number;
  dailyStats: DailyStats[];
  vocabGrowth: Array<{ date: string; known: number; learning: number; total: number }>;
  activityData: Array<{ date: string; count: number }>;
  collectionCounts: Record<ClozeCollection, { total: number; due: number; mastered: number }>;
}

// Stat card component
function StatCard({
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
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 transition-transform hover:scale-[1.02]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm font-medium">{label}</p>
          <p className={`text-4xl font-bold mt-1 ${textColors[color]}`}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {sublabel && <p className="text-zinc-400 dark:text-zinc-500 text-sm mt-1">{sublabel}</p>}
        </div>
        {icon && <div className={`${textColors[color]} opacity-60`}>{icon}</div>}
      </div>
    </div>
  );
}

// Word state breakdown component
function WordStateBreakdown({ byState }: { byState: Record<WordState, number> }) {
  const states: { key: WordState; label: string; color: string; bgColor: string }[] = [
    { key: 'known', label: 'Known', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-500' },
    { key: 'level4', label: 'Level 4', color: 'text-green-500 dark:text-green-300', bgColor: 'bg-green-400' },
    { key: 'level3', label: 'Level 3', color: 'text-yellow-500 dark:text-yellow-300', bgColor: 'bg-yellow-400' },
    { key: 'level2', label: 'Level 2', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-500' },
    { key: 'level1', label: 'Level 1', color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-500' },
    { key: 'new', label: 'New', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-500' },
    { key: 'ignored', label: 'Ignored', color: 'text-zinc-500 dark:text-zinc-400', bgColor: 'bg-zinc-400 dark:bg-zinc-500' },
  ];

  const total = Object.values(byState).reduce((a, b) => a + b, 0);

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Words by State</h3>
      <div className="space-y-3">
        {states.map(({ key, label, color, bgColor }) => {
          const count = byState[key] || 0;
          const percentage = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={key}>
              <div className="flex justify-between text-sm mb-1">
                <span className={color}>{label}</span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {count.toLocaleString()} ({percentage.toFixed(1)}%)
                </span>
              </div>
              <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
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
function ClozeStats({
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
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Cloze Practice</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="text-center p-4 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg">
          <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">{attempts.toLocaleString()}</div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Sentences Practiced</div>
        </div>
        <div className="text-center p-4 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg">
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">{accuracy.toFixed(1)}%</div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Accuracy</div>
        </div>
        <div className="text-center p-4 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg col-span-2">
          <div className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">{points.toLocaleString()}</div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Total Points</div>
        </div>
      </div>
    </div>
  );
}

// Sentence mastery component
function SentenceMastery({
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

  const collections = Object.entries(collectionCounts).filter(
    ([, counts]) => counts.total > 0
  );

  const overallTotal = collections.reduce((sum, [, c]) => sum + c.total, 0);
  const overallMastered = collections.reduce((sum, [, c]) => sum + c.mastered, 0);
  const overallPercentage = overallTotal > 0 ? (overallMastered / overallTotal) * 100 : 0;

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Sentence Mastery</h3>
        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
          {overallPercentage.toFixed(1)}% overall
        </span>
      </div>

      {/* Overall progress bar */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-zinc-500 dark:text-zinc-400">
            {overallMastered.toLocaleString()} / {overallTotal.toLocaleString()} mastered
          </span>
        </div>
        <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
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
              <div className="flex justify-between text-sm mb-1">
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                  {collectionLabels[collection] || collection}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {counts.mastered} / {counts.total} ({pct.toFixed(0)}%)
                </span>
              </div>
              <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500/80 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {counts.due > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
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

// Helper function to calculate streak
function calculateStreak(dailyStats: DailyStats[]): { current: number; longest: number } {
  if (dailyStats.length === 0) return { current: 0, longest: 0 };

  // Sort by date descending
  const sorted = [...dailyStats].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Check if today or yesterday has activity
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  let lastDate: Date | null = null;

  // Calculate current streak
  for (const stat of sorted) {
    const hasActivity = stat.wordsRead > 0 || stat.clozePracticed > 0;
    if (!hasActivity) continue;

    if (currentStreak === 0) {
      // First active day must be today or yesterday
      if (stat.date === today || stat.date === yesterday) {
        currentStreak = 1;
        lastDate = new Date(stat.date);
      }
    } else if (lastDate) {
      const statDate = new Date(stat.date);
      const dayDiff = Math.round(
        (lastDate.getTime() - statDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (dayDiff === 1) {
        currentStreak++;
        lastDate = statDate;
      } else {
        break;
      }
    }
  }

  // Calculate longest streak
  lastDate = null;
  for (const stat of sorted) {
    const hasActivity = stat.wordsRead > 0 || stat.clozePracticed > 0;
    if (!hasActivity) {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 0;
      lastDate = null;
      continue;
    }

    const statDate = new Date(stat.date);
    if (!lastDate) {
      tempStreak = 1;
      lastDate = statDate;
    } else {
      const dayDiff = Math.round(
        (lastDate.getTime() - statDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (dayDiff === 1) {
        tempStreak++;
        lastDate = statDate;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
        lastDate = statDate;
      }
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak);

  return { current: currentStreak, longest: longestStreak };
}

// Format minutes as hours and minutes
function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export default function StatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        // Get vocab stats, books, and collection counts in parallel
        const [vocabStats, books, collectionCounts] = await Promise.all([
          getVocabStats(),
          getAllBooks(),
          getCollectionCounts(),
        ]);

        const completedBooks = books.filter((b) => b.progress.percentComplete >= 100);

        // Get all daily stats for the past year
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 1);
        const startDateStr = startDate.toISOString().split('T')[0];

        const dailyStats = await getStatsForDateRange(startDateStr, endDate);

        // Calculate totals from daily stats
        const totalReadingMinutes = dailyStats.reduce((sum, d) => sum + d.minutesRead, 0);
        const totalClozeAttempts = dailyStats.reduce((sum, d) => sum + d.clozePracticed, 0);
        const totalPoints = dailyStats.reduce((sum, d) => sum + d.points, 0);

        // Get cloze correct count from db
        const clozeSentences = await getAllClozeSentences();
        const totalClozeCorrect = clozeSentences.reduce((sum, c) => sum + c.timesCorrect, 0);

        // Calculate streaks
        const { current: currentStreak, longest: longestStreak } = calculateStreak(dailyStats);

        // Build activity heatmap data (words read per day)
        const activityData = dailyStats.map((d) => ({
          date: d.date,
          count: d.wordsRead,
        }));

        // Build vocab growth data (cumulative over time)
        const sortedDailyStats = [...dailyStats].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        let cumulativeKnown = 0;
        let cumulativeLearning = 0;
        let cumulativeTotal = 0;

        const vocabGrowth = sortedDailyStats.map((d) => {
          cumulativeKnown += d.wordsMarkedKnown;
          cumulativeLearning += d.newWordsSaved;
          cumulativeTotal += d.newWordsSaved;
          return {
            date: d.date,
            known: cumulativeKnown,
            learning: Math.max(0, cumulativeLearning - cumulativeKnown),
            total: cumulativeTotal,
          };
        });

        // If we have current vocab stats, use those for the final values
        if (vocabGrowth.length > 0) {
          const lastEntry = vocabGrowth[vocabGrowth.length - 1];
          lastEntry.known = vocabStats.byState.known;
          lastEntry.learning =
            vocabStats.byState.level1 +
            vocabStats.byState.level2 +
            vocabStats.byState.level3 +
            vocabStats.byState.level4;
          lastEntry.total = vocabStats.total - vocabStats.byState.ignored;
        }

        const totalLearning =
          vocabStats.byState.level1 +
          vocabStats.byState.level2 +
          vocabStats.byState.level3 +
          vocabStats.byState.level4;

        setStats({
          totalKnown: vocabStats.byState.known,
          totalLearning,
          totalWords: vocabStats.total,
          byState: vocabStats.byState,
          currentStreak,
          longestStreak,
          booksRead: completedBooks.length,
          totalBooks: books.length,
          totalReadingMinutes,
          totalClozeAttempts,
          totalClozeCorrect,
          totalPoints,
          dailyStats,
          vocabGrowth,
          activityData,
          collectionCounts,
        });
      } catch (error) {
        console.error('Failed to load stats:', error);
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-zinc-500 dark:text-zinc-400">Loading your stats...</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 dark:text-red-400 mb-4">Failed to load statistics</p>
          <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Date subtitle */}
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>

        {/* Top stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <StatCard
            label="Words Known"
            value={stats.totalKnown}
            sublabel={`${stats.totalLearning} words in progress`}
            color="green"
            icon={
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }
          />
          <StatCard
            label="Current Streak"
            value={`${stats.currentStreak} days`}
            sublabel={`Longest: ${stats.longestStreak} days`}
            color="orange"
            icon={
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"
                />
              </svg>
            }
          />
        </div>

        {/* Vocabulary Growth Chart */}
        <div className="mb-8">
          <VocabGrowthChart data={stats.vocabGrowth} />
        </div>

        {/* Activity Heatmap */}
        <div className="mb-8">
          <ActivityHeatmap data={stats.activityData} />
        </div>

        {/* Bottom stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard
            label="Learning (L1-L4)"
            value={stats.totalLearning}
            sublabel="Words in progress"
            color="yellow"
            icon={
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            }
          />
          <StatCard
            label="Books Read"
            value={stats.booksRead}
            sublabel={`${stats.totalBooks} total in library`}
            color="purple"
            icon={
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            }
          />
          <StatCard
            label="Time Reading"
            value={formatTime(stats.totalReadingMinutes)}
            sublabel="Total time invested"
            color="blue"
            icon={
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }
          />
        </div>

        {/* Detailed breakdowns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <WordStateBreakdown byState={stats.byState} />
          <ClozeStats
            attempts={stats.totalClozeAttempts}
            correct={stats.totalClozeCorrect}
            points={stats.totalPoints}
          />
        </div>

        {/* Sentence Mastery */}
        <SentenceMastery collectionCounts={stats.collectionCounts} />
      </main>
    </div>
  );
}
