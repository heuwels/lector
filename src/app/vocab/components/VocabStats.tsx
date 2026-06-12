import { WordState } from "@/types";

export default function VocabStats({
    stats,
}: {
    stats: { total: number; byState: Record<WordState, number> };
}) {
    const learningCount =
        stats.byState.new +
        stats.byState.level1 +
        stats.byState.level2 +
        stats.byState.level3 +
        stats.byState.level4;

    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-gray-100 p-3 dark:bg-gray-800">
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Total Words</div>
            </div>
            <div className="rounded-lg bg-blue-100 p-3 dark:bg-blue-900/30">
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{learningCount}</div>
                <div className="text-sm text-blue-600 dark:text-blue-400">Learning</div>
            </div>
            <div className="rounded-lg bg-green-100 p-3 dark:bg-green-900/30">
                <div className="text-2xl font-bold text-green-700 dark:text-green-400">
                    {stats.byState.known}
                </div>
                <div className="text-sm text-green-600 dark:text-green-400">Known</div>
            </div>
            <div className="rounded-lg bg-gray-100 p-3 dark:bg-gray-800">
                <div className="text-2xl font-bold text-gray-500 dark:text-gray-500">
                    {stats.byState.ignored}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-500">Ignored</div>
            </div>
        </div>
    );
}
