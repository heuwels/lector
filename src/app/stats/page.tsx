'use client';

import { useEffect, useState } from 'react';
import { Book, CheckCircle, Flame } from 'lucide-react';
import Link from 'next/link';
import {
  getStatsForDateRange,
  getAllClozeSentences,
  getCollectionCounts,
  getFluencyStats,
  getStreak,
  getSetting,
} from '@/lib/data-layer';
import { addDaysToDateString, dateStringInTimeZone, isValidTimeZone } from '@/lib/dates';
import ActivityHeatmap from '@/components/ActivityHeatmap';
import PageHeader from '@/components/PageHeader';
import VocabGrowthChart from '@/components/VocabGrowthChart';
import {
  ClozeStats,
  FluencyBadge,
  SentenceMastery,
  StatCard,
  StatsSkeleton,
  WordStateBreakdown,
} from './components';
import { StatsData } from './types';

export default function StatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        const [collectionCounts, fluency, streakData, tzSetting] = await Promise.all([
          getCollectionCounts(),
          getFluencyStats(),
          getStreak(),
          getSetting<string>('timezone'),
        ]);

        // Get all daily stats for the past year. "Today" is a calendar date
        // in the configured time zone (falling back to this device's zone),
        // not UTC — otherwise the window misses today's row before 10:00
        // AEST (issue #108).
        const timeZone =
          tzSetting && isValidTimeZone(tzSetting)
            ? tzSetting
            : Intl.DateTimeFormat().resolvedOptions().timeZone;
        const endDate = dateStringInTimeZone(new Date(), timeZone);
        const startDateStr = addDaysToDateString(endDate, -365);

        const dailyStats = await getStatsForDateRange(startDateStr, endDate);

        const totalClozeAttempts = dailyStats.reduce((sum, d) => sum + d.clozePracticed, 0);
        const totalPoints = dailyStats.reduce((sum, d) => sum + d.points, 0);

        // Get cloze correct count from db
        const clozeSentences = await getAllClozeSentences();
        const totalClozeCorrect = clozeSentences.reduce((sum, c) => sum + c.timesCorrect, 0);

        // Unified server-side streaks (issue #108) — one definition app-wide.
        const currentStreak = streakData.streak;
        const longestStreak = streakData.longest;

        // Build activity heatmap data (dictionary lookups per day)
        const activityData = dailyStats.map((d) => ({
          date: d.date,
          count: d.dictionaryLookups,
        }));

        // Build vocab growth data (cumulative over time)
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
          dailyStats,
          vocabGrowth,
          activityData,
          collectionCounts,
          fluency,
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
    return <StatsSkeleton />;
  }

  if (!stats) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="mb-4 text-destructive">Failed to load statistics</p>
          <Link href="/" className="text-primary hover:underline">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader title="Statistics">
        <p className="text-sm text-muted-foreground">
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
      <div data-testid="stats-top-cards" className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
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
          label="Current Streak"
          value={`${stats.currentStreak} days`}
          sublabel={`Longest: ${stats.longestStreak} days`}
          color="orange"
          icon={<Flame size="24" />}
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
