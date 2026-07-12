'use client';

import { useEffect, useMemo, useState } from 'react';
import { Book, BookOpen, CheckCircle, Flame } from 'lucide-react';
import Link from 'next/link';
import {
  getAllDailyStats,
  getAppWideActivity,
  getClozeTotals,
  getAllVocab,
  getCollectionCounts,
  getFluencyStats,
  getReadingStats,
  getStreak,
  getSetting,
  syncAnkiReviews,
} from '@/lib/data-layer';
import { lectorMode } from '@/lib/api-base';
import { dateStringInTimeZone, isValidTimeZone } from '@/lib/dates';
import { compositeActivityCount, deriveVocabGrowth, sliceSeriesByDays } from '@/lib/stats-derive';
import ActivityHeatmap from '@/components/ActivityHeatmap';
import AnkiReviewsChart from '@/components/AnkiReviewsChart';
import PageHeader from '@/components/PageHeader';
import VocabGrowthChart from '@/components/VocabGrowthChart';
import DomainFluencyRadar from '@/components/DomainFluencyRadar';
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
        // Best-effort: pull Anki's review history into dailyStats first, so the
        // streak and activity heatmap below include today's Anki study. No-ops
        // when Anki isn't running (see /api/anki/sync-reviews). AnkiConnect
        // transport only (#241): the endpoint reaches AnkiConnect from the
        // SERVER — pointless in cloud and on the addon transport, where the
        // addon pushes the same per-day counts via POST /api/anki/reviews.
        // (Read the setting inline rather than via useAnkiTransport: this
        // effect must run exactly once, and sync must finish before the
        // dailyStats fetch below or the heatmap misses today's reviews.)
        if (lectorMode() !== 'cloud') {
          const transport = await getSetting<string>('ankiTransport').catch(() => null);
          if (transport !== 'addon') {
            await syncAnkiReviews().catch(() => {});
          }
        }

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
        // The per-language series feeds the per-language panels; the app-wide
        // activity series feeds the heatmap only (#238).
        const [dailyStats, allVocab, appWideActivity] = await Promise.all([
          getAllDailyStats(),
          getAllVocab(),
          getAppWideActivity(),
        ]);
        const last365 = sliceSeriesByDays(dailyStats, 365, endDate);
        const activityLast365 = sliceSeriesByDays(appWideActivity, 365, endDate);

        const totalClozeAttempts = last365.reduce((sum, d) => sum + d.clozePracticed, 0);
        const totalPoints = last365.reduce((sum, d) => sum + d.points, 0);

        // Lifetime cloze-correct total — a server-side SUM, not the whole
        // table shipped over just to reduce it here (#240).
        const { timesCorrect: totalClozeCorrect } = await getClozeTotals();

        // Unified server-side streaks (issue #108) — one definition app-wide.
        const currentStreak = streakData.streak;
        const longestStreak = streakData.longest;

        // Activity heatmap: composite study activity (lookups + cloze reviews +
        // reading minutes + Anki) over the APP-WIDE series, so the heatmap
        // agrees with the equally app-wide streak — a day studied only in
        // another language must not render as an empty cell (#238). All other
        // panels stay language-scoped. Limited to the last year it renders.
        const activityData = activityLast365.map((d) => ({
          date: d.date,
          count: compositeActivityCount(d),
          // Per-type breakdown so the heatmap tooltip can show what made up the day.
          parts: {
            dictionaryLookups: d.dictionaryLookups || 0,
            clozePracticed: d.clozePracticed || 0,
            minutesRead: d.minutesRead || 0,
            ankiReviews: d.ankiReviews || 0,
          },
        }));

        // Keep daily stats in date order for the Anki series below.
        const sortedDailyStats = [...dailyStats].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );

        // Vocabulary growth over time, reconstructed from the per-word dated
        // vocab log (createdAt / stateUpdatedAt) rather than the dailyStats
        // deltas. Those deltas are only written by the reader UI, so word
        // level-ups, practice, and imports never registered — the old
        // cumulative-from-deltas curve sat flat at ~0 and a final-point pin to
        // the live total then dumped every learning word onto today. The
        // endpoint is still reconciled to the live fluency counts so the chart
        // agrees with the cards; any dateless excess becomes a starting
        // baseline rather than a spike. See deriveVocabGrowth.
        const vocabGrowth = deriveVocabGrowth(allVocab, timeZone, {
          liveTotals: {
            known: fluency.totalKnownWords,
            learning: fluency.totalLearning,
            new: fluency.totalNew,
          },
          endDate,
        });

        // Anki reviews/day: chart the last 90 days, but decide the
        // connected-vs-preview state from full history so a previously-synced
        // user keeps their chart even after a quiet spell.
        const ankiHasData = sortedDailyStats.some((d) => (d.ankiReviews ?? 0) > 0);
        const ankiReviews = sliceSeriesByDays(
          sortedDailyStats.map((d) => ({ date: d.date, reviews: d.ankiReviews ?? 0 })),
          90,
          endDate,
        );

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
          ankiReviews,
          ankiHasData,
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

      <DomainFluencyRadar byDomain={stats.fluency.byDomain} pending={stats.fluency.pending} />

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
        <ActivityHeatmap data={stats.activityData} unit="actions" endDate={stats.endDate} />
      </div>

      {/* Anki Reviews */}
      <div className="mb-8">
        <AnkiReviewsChart data={stats.ankiReviews} hasData={stats.ankiHasData} />
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
