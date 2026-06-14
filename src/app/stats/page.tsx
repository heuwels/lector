'use client';

import { useEffect, useMemo, useState } from 'react';
import { Book, BookOpen, CheckCircle, Flame } from 'lucide-react';
import Link from 'next/link';
import {
  getAllDailyStats,
  getAllClozeSentences,
  getCollectionCounts,
  getFluencyStats,
  getReadingStats,
  getStreak,
  getSetting,
} from '@/lib/data-layer';
import { dateStringInTimeZone, isValidTimeZone } from '@/lib/dates';
import { compositeActivityCount, sliceSeriesByDays } from '@/lib/stats-derive';
import ActivityHeatmap from '@/components/ActivityHeatmap';
import PageHeader from '@/components/PageHeader';
import VocabGrowthChart from '@/components/VocabGrowthChart';
import {
  ClozeStats,
  FluencyBadge,
  RangeSelector,
  SentenceMastery,
  StatCard,
  StatsSkeleton,
  WordStateBreakdown,
} from './components';
import { StatsData } from './types';

export default function StatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  // Time window for the vocabulary-growth chart. Defaults to one year.
  const [range, setRange] = useState<number | null>(365);

  useEffect(() => {
    async function loadStats() {
      try {
        const [collectionCounts, fluency, reading, streakData, tzSetting] = await Promise.all([
          getCollectionCounts(),
          getFluencyStats(),
          getReadingStats(),
          getStreak(),
          getSetting<string>('timezone'),
        ]);

        // "Today" is a calendar date in the configured time zone (falling back
        // to this device's zone), not UTC — otherwise the window misses today's
        // row before 10:00 AEST (issue #108).
        const timeZone =
          tzSetting && isValidTimeZone(tzSetting)
            ? tzSetting
            : Intl.DateTimeFormat().resolvedOptions().timeZone;
        const endDate = dateStringInTimeZone(new Date(), timeZone);

        // Fetch all history so the "All" range and the cumulative growth series
        // have everything; panels that are scoped to "the last year" slice it.
        const dailyStats = await getAllDailyStats();
        const last365 = sliceSeriesByDays(dailyStats, 365, endDate);

        const totalClozeAttempts = last365.reduce((sum, d) => sum + d.clozePracticed, 0);
        const totalPoints = last365.reduce((sum, d) => sum + d.points, 0);

        // Get cloze correct count from db
        const clozeSentences = await getAllClozeSentences();
        const totalClozeCorrect = clozeSentences.reduce((sum, c) => sum + c.timesCorrect, 0);

        // Unified server-side streaks (issue #108) — one definition app-wide.
        const currentStreak = streakData.streak;
        const longestStreak = streakData.longest;

        // Activity heatmap: composite study activity (lookups + cloze reviews +
        // reading minutes) so the heatmap agrees with the streak, not dictionary
        // lookups alone. Limited to the last year the heatmap renders.
        const activityData = last365.map((d) => ({
          date: d.date,
          count: compositeActivityCount(d),
        }));

        // Build vocab growth data (cumulative over all history)
        const sortedDailyStats = [...dailyStats].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
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

        // Pin the final values to the live word-state counts so the chart's
        // endpoint matches the cards. All word counts on this page come from
        // the knownWords table (via /api/stats/fluency) — one source, so the
        // fluency badge, top cards, and breakdown always agree.
        if (vocabGrowth.length > 0) {
          const lastEntry = vocabGrowth[vocabGrowth.length - 1];
          lastEntry.known = fluency.totalKnownWords;
          lastEntry.learning = fluency.totalLearning;
          lastEntry.total = fluency.totalKnownWords + fluency.totalLearning + fluency.totalNew;
        }

        setStats({
          totalKnown: fluency.totalKnownWords,
          totalLearning: fluency.totalLearning,
          byState: fluency.byState,
          currentStreak,
          longestStreak,
          totalClozeAttempts,
          totalClozeCorrect,
          totalPoints,
          reading,
          dailyStats,
          vocabGrowth,
          activityData,
          collectionCounts,
          fluency,
          endDate,
        });
      } catch (error) {
        console.error('Failed to load stats:', error);
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, []);

  // Window the cumulative growth series for display. Cumulative values are kept
  // intact — only the x-window narrows.
  const displayedVocabGrowth = useMemo(
    () => (stats ? sliceSeriesByDays(stats.vocabGrowth, range, stats.endDate) : []),
    [stats, range],
  );

  if (loading) {
    return <StatsSkeleton />;
  }

  if (!stats) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-center">
          <p className="mb-4 text-red-500 dark:text-red-400">Failed to load statistics</p>
          <Link href="/" className="text-blue-600 hover:underline dark:text-blue-400">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader title="Statistics">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </PageHeader>
      <FluencyBadge fluency={stats.fluency} />

      {/* Top stat cards */}
      <div
        data-testid="stats-top-cards"
        className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          label="Words Known"
          value={stats.totalKnown}
          color="green"
          icon={<CheckCircle size="24" />}
        />
        <StatCard
          label="Learning (L1-L4)"
          value={stats.totalLearning}
          sublabel="Words in progress"
          color="yellow"
          icon={<Book size="24" />}
        />
        <StatCard
          label="Words Read"
          value={stats.reading.wordsRead}
          sublabel="Estimated from reading position"
          color="blue"
          icon={<BookOpen size="24" />}
        />
        <StatCard
          label="Current Streak"
          value={`${stats.currentStreak} days`}
          sublabel={`Longest: ${stats.longestStreak} days`}
          color="orange"
          icon={<Flame size="24" />}
        />
      </div>

      {/* Vocabulary Growth Chart */}
      <div className="mb-8">
        <VocabGrowthChart
          data={displayedVocabGrowth}
          controls={<RangeSelector value={range} onChange={setRange} />}
        />
      </div>

      {/* Activity Heatmap */}
      <div className="mb-8">
        <ActivityHeatmap data={stats.activityData} unit="actions" />
      </div>

      {/* Detailed breakdowns */}
      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
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
  );
}
