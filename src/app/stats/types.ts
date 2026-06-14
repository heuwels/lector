import { FluencyStats, ReadingStats } from "@/lib/data-layer";
import { ClozeCollection, DailyStats, WordState } from "@/types";

export interface StatsData {
  totalKnown: number;
  totalLearning: number;
  byState: Record<WordState, number>;
  currentStreak: number;
  longestStreak: number;
  totalClozeAttempts: number;
  totalClozeCorrect: number;
  totalPoints: number;
  reading: ReadingStats;
  dailyStats: DailyStats[];
  // Full-history cumulative series; the page windows it for display via the range selector.
  vocabGrowth: Array<{ date: string; known: number; learning: number; total: number }>;
  activityData: Array<{ date: string; count: number }>;
  // Anki reviews/day for the chart (last 90 days). `ankiHasData` is computed from
  // full history so a previously-connected user keeps their chart after a quiet
  // spell; when false the chart shows the "Connect your Anki" preview.
  ankiReviews: Array<{ date: string; reviews: number }>;
  ankiHasData: boolean;
  collectionCounts: Record<ClozeCollection, { total: number; due: number; mastered: number }>;
  fluency: FluencyStats;
  // Today's date in the user's time zone — the anchor for windowing the series.
  endDate: string;
}
