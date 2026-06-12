import { FluencyStats } from "@/lib/data-layer";
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
  dailyStats: DailyStats[];
  vocabGrowth: Array<{ date: string; known: number; learning: number; total: number }>;
  activityData: Array<{ date: string; count: number }>;
  collectionCounts: Record<ClozeCollection, { total: number; due: number; mastered: number }>;
  fluency: FluencyStats;
}
