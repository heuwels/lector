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
            <div className="rounded-lg bg-muted p-3">
                <div className="text-2xl font-bold text-foreground">{stats.total}</div>
                <div className="text-sm text-muted-foreground">Total Words</div>
            </div>
            <div className="rounded-lg bg-[var(--gold-soft)] p-3">
                <div className="text-2xl font-bold text-[var(--gold-strong)]">{learningCount}</div>
                <div className="text-sm text-[var(--gold-strong)]">Learning</div>
            </div>
            <div className="rounded-lg bg-[var(--primary-soft)] p-3">
                <div className="text-2xl font-bold text-primary">
                    {stats.byState.known}
                </div>
                <div className="text-sm text-primary">Known</div>
            </div>
            <div className="rounded-lg bg-muted p-3">
                <div className="text-2xl font-bold text-muted-foreground">
                    {stats.byState.ignored}
                </div>
                <div className="text-sm text-muted-foreground">Ignored</div>
            </div>
        </div>
    );
}
