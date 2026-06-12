import NavHeader from "@/components/NavHeader";
import { ClozeCollection, FluencyStats, WordState } from "@/lib/data-layer";

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
export function WordStateBreakdown({ byState }: { byState: Record<WordState, number> }) {
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

// Fluency badge component
export function FluencyBadge({ fluency }: { fluency: FluencyStats }) {
    const { estimatedLevel, progressToNextLevel, totalKnownWords, totalLearning, weeklyGrowth } = fluency;
    const growthDelta = weeklyGrowth.delta;

    return (
        <div data-testid="fluency-section" className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                <div className="flex items-center gap-4">
                    <span
                        data-testid="fluency-level-badge"
                        className="inline-flex items-center px-4 py-2 rounded-lg text-lg font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                    >
                        {estimatedLevel.code}
                    </span>
                    <div>
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                            {estimatedLevel.code} &mdash; {estimatedLevel.label}
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            Estimated CEFR Level
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {growthDelta !== 0 && (
                        <span
                            data-testid="fluency-weekly-growth"
                            className={`inline-flex items-center gap-1 text-sm font-medium ${growthDelta > 0
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-500 dark:text-red-400'
                                }`}
                        >
                            {growthDelta > 0 ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
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
                <div className="flex justify-between text-sm mb-1">
                    <span className="text-zinc-500 dark:text-zinc-400">
                        Progress to next level
                    </span>
                    <span className="text-zinc-500 dark:text-zinc-400">{progressToNextLevel}%</span>
                </div>
                <div
                    data-testid="fluency-progress-bar"
                    className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden"
                >
                    <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${progressToNextLevel}%` }}
                    />
                </div>
            </div>

            {/* Known / Learning counts */}
            <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg">
                    <div data-testid="fluency-known-count" className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {totalKnownWords.toLocaleString()}
                    </div>
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">Known</div>
                </div>
                <div className="text-center p-3 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg">
                    <div data-testid="fluency-learning-count" className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                        {totalLearning.toLocaleString()}
                    </div>
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">Learning</div>
                </div>
            </div>
        </div>
    );
}


export function SkeletonBlock({ className = '' }: { className?: string }) {
    return (
        <div
            className={`animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded ${className}`}
        />
    );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
    return (
        <div
            className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 ${className}`}
        >
            <SkeletonBlock className="h-4 w-24 mb-3" />
            <SkeletonBlock className="h-10 w-32 mb-2" />
            <SkeletonBlock className="h-3 w-20" />
        </div>
    );
}

export function StatsSkeleton() {
    return (
        <div
            data-testid="stats-skeleton"
            className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pt-[var(--mobile-topbar-h)] sm:pt-0 sm:ml-56"
        >
            <NavHeader />
            <main className="max-w-7xl mx-auto px-6 py-8">
                <SkeletonBlock className="h-4 w-56 mb-6" />

                {/* Fluency badge skeleton */}
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 mb-8">
                    <div className="flex items-center gap-4 mb-4">
                        <SkeletonBlock className="h-10 w-16" />
                        <div className="flex-1">
                            <SkeletonBlock className="h-5 w-48 mb-2" />
                            <SkeletonBlock className="h-4 w-32" />
                        </div>
                    </div>
                    <SkeletonBlock className="h-3 w-full mb-4" />
                    <div className="grid grid-cols-2 gap-4">
                        <SkeletonBlock className="h-16" />
                        <SkeletonBlock className="h-16" />
                    </div>
                </div>

                {/* Top stat cards skeleton */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                </div>

                {/* Vocab growth chart skeleton */}
                <SkeletonBlock className="h-72 mb-8" />

                {/* Activity heatmap skeleton */}
                <SkeletonBlock className="h-56 mb-8" />

                {/* Detailed breakdowns skeleton */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    <SkeletonBlock className="h-72" />
                    <SkeletonBlock className="h-72" />
                </div>

                {/* Sentence mastery skeleton */}
                <SkeletonBlock className="h-64" />
            </main>
        </div>
    );
}