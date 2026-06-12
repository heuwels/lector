import { useState } from "react";
import { Correction, JournalEntry } from "@/lib/data-layer";
import { formatDateTime } from "./utils";
import { correctionTypeLabels } from "./constants";

export function CorrectionBadge({ type }: { type: string }) {
    const info = correctionTypeLabels[type] || { label: type, className: 'bg-zinc-100 text-zinc-600' };
    return (
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${info.className}`}>
            {info.label}
        </span>
    );
}

export function HighlightedText({ body, corrections }: { body: string; corrections: Correction[] }) {
    const [activeIdx, setActiveIdx] = useState<number | null>(null);

    if (corrections.length === 0) {
        return <span>{body}</span>;
    }

    // Find correction positions in the original text via substring search
    type Span = { start: number; end: number; correctionIdx: number };
    const spans: Span[] = [];
    for (let i = 0; i < corrections.length; i++) {
        const c = corrections[i];
        // Search from after the last found span to handle duplicates
        const searchFrom = spans.length > 0 ? spans[spans.length - 1].end : 0;
        const idx = body.indexOf(c.original, searchFrom);
        if (idx !== -1) {
            spans.push({ start: idx, end: idx + c.original.length, correctionIdx: i });
        }
    }

    // Sort by position
    spans.sort((a, b) => a.start - b.start);

    // Build segments
    const segments: React.ReactNode[] = [];
    let cursor = 0;
    for (const span of spans) {
        if (span.start > cursor) {
            segments.push(<span key={`t-${cursor}`}>{body.slice(cursor, span.start)}</span>);
        }
        const c = corrections[span.correctionIdx];
        const isActive = activeIdx === span.correctionIdx;
        segments.push(
            <span key={`c-${span.correctionIdx}`} className="relative inline">
                <button
                    onClick={(e) => { e.stopPropagation(); setActiveIdx(isActive ? null : span.correctionIdx); }}
                    className="underline decoration-wavy decoration-red-400 dark:decoration-red-500 underline-offset-4 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded px-0.5 -mx-0.5 cursor-pointer transition-colors"
                >
                    {body.slice(span.start, span.end)}
                </button>
                {isActive && (
                    <span className="absolute left-0 top-full mt-1 z-10 w-64 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-3 shadow-lg text-left">
                        <span className="flex items-center gap-2 mb-1">
                            <CorrectionBadge type={c.type} />
                        </span>
                        <span className="block text-sm mb-1">
                            <span className="line-through text-red-600 dark:text-red-400">{c.original}</span>
                            {' → '}
                            <span className="font-medium text-green-700 dark:text-green-400">{c.corrected}</span>
                        </span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{c.explanation}</span>
                    </span>
                )}
            </span>
        );
        cursor = span.end;
    }
    if (cursor < body.length) {
        segments.push(<span key={`t-${cursor}`}>{body.slice(cursor)}</span>);
    }

    return (
        <span onClick={() => setActiveIdx(null)}>
            {segments}
        </span>
    );
}

export function CorrectionView({ entry }: { entry: JournalEntry }) {
    const corrections = entry.corrections || [];

    return (
        <div className="space-y-6">
            {/* Original with inline highlights */}
            <div>
                <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Your text</h3>
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                    <HighlightedText body={entry.body} corrections={corrections} />
                </div>
                {corrections.length > 0 && (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">Click highlighted words to see corrections</p>
                )}
            </div>

            {/* Corrected version */}
            {entry.correctedBody && entry.correctedBody !== entry.body && (
                <div>
                    <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Corrected</h3>
                    <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                        {entry.correctedBody}
                    </div>
                </div>
            )}

            {/* Summary */}
            {corrections.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {corrections.length} correction{corrections.length !== 1 ? 's' : ''}:
                    </span>
                    {corrections.map((c, i) => (
                        <CorrectionBadge key={i} type={c.type} />
                    ))}
                </div>
            ) : (
                <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 p-4 text-center">
                    <p className="text-green-800 dark:text-green-300 font-medium">Perfek! No corrections needed.</p>
                </div>
            )}
        </div>
    );
}

export function HistoryCard({
    entry,
    onSelect,
    onDelete,
}: {
    entry: JournalEntry;
    onSelect: (e: JournalEntry) => void;
    onDelete: (id: string) => void;
}) {
    const preview = entry.body.length > 120 ? entry.body.slice(0, 120) + '…' : entry.body;
    const correctionCount = entry.corrections?.length ?? 0;

    return (
        <div
            onClick={() => onSelect(entry)}
            className="cursor-pointer rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        >
            <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {formatDateTime(entry.createdAt)}
                </span>
                <div className="flex items-center gap-2">
                    {entry.status === 'submitted' ? (
                        <span className="rounded-full bg-green-100 dark:bg-green-900/40 px-2 py-0.5 text-xs font-medium text-green-800 dark:text-green-300">
                            {correctionCount > 0 ? `${correctionCount} correction${correctionCount !== 1 ? 's' : ''}` : 'Perfect'}
                        </span>
                    ) : (
                        <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                            Draft
                        </span>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
                        className="text-zinc-400 hover:text-red-500 transition-colors"
                        title="Delete entry"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">{preview}</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{entry.wordCount} words</p>
        </div>
    );
}

export function EntryModal({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        {formatDateTime(entry.createdAt)}
                    </h2>
                    <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                {entry.status === 'submitted' ? (
                    <CorrectionView entry={entry} />
                ) : (
                    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                        {entry.body}
                    </div>
                )}
            </div>
        </div>
    );
}