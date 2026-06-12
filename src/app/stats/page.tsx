'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import NavHeader from '@/components/NavHeader';
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
import VocabGrowthChart from '@/components/VocabGrowthChart';
import { ClozeStats, FluencyBadge, SentenceMastery, StatCard, StatsSkeleton, WordStateBreakdown } from './components';
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
        const timeZone = tzSetting && isValidTimeZone(tzSetting)
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

        // Pin the final values to the live word-state counts so the chart's
        // endpoint matches the cards. All word counts on this page come from
        // the knownWords table (via /api/stats/fluency) — one source, so the
        // fluency badge, top cards, and breakdown always agree.
        if (vocabGrowth.length > 0) {
          const lastEntry = vocabGrowth[vocabGrowth.length - 1];
          lastEntry.known = fluency.totalKnownWords;
          lastEntry.learning = fluency.totalLearning;
          lastEntry.total =
            fluency.totalKnownWords + fluency.totalLearning + fluency.totalNew;
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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pt-[var(--mobile-topbar-h)] sm:pt-0 sm:ml-56">
      <NavHeader />
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

        {/* Fluency level */}
        <FluencyBadge fluency={stats.fluency} />

        {/* Top stat cards */}
        <div data-testid="stats-top-cards" className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard
            label="Words Known"
            value={stats.totalKnown}
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
