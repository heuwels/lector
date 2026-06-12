import { useState } from 'react';
import { VocabEntry, WordState } from "@/types";

export default function VocabDetailModal({
    entry,
    onClose,
    onUpdate,
    onDelete,
}: {
    entry: VocabEntry;
    onClose: () => void;
    onUpdate: (id: string, updates: Partial<VocabEntry>) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [translation, setTranslation] = useState(entry.translation);
    const [state, setState] = useState<WordState>(entry.state);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onUpdate(entry.id, { translation, state });
            setIsEditing(false);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this vocabulary entry?')) {
            return;
        }
        setIsDeleting(true);
        try {
            await onDelete(entry.id);
            onClose();
        } finally {
            setIsDeleting(false);
        }
    };

    // State color classes for dropdown
    const stateOptions: { value: WordState; label: string; color: string }[] = [
        { value: 'new', label: 'New', color: 'bg-gray-200' },
        { value: 'level1', label: 'Level 1', color: 'bg-blue-800' },
        { value: 'level2', label: 'Level 2', color: 'bg-blue-600' },
        { value: 'level3', label: 'Level 3', color: 'bg-blue-400' },
        { value: 'level4', label: 'Level 4', color: 'bg-blue-200' },
        { value: 'known', label: 'Known', color: 'bg-green-500' },
        { value: 'ignored', label: 'Ignored', color: 'bg-gray-400' },
    ];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="mb-4 flex items-start justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{entry.text}</h2>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            {entry.type === 'phrase' ? 'Phrase' : 'Word'}
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    >
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="space-y-4">
                    {/* Translation */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Translation
                        </label>
                        {isEditing ? (
                            <textarea
                                value={translation}
                                onChange={(e) => setTranslation(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                                rows={2}
                            />
                        ) : (
                            <p className="text-gray-900 dark:text-gray-100">{entry.translation}</p>
                        )}
                    </div>

                    {/* Context Sentence */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Context Sentence
                        </label>
                        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 italic dark:bg-gray-800 dark:text-gray-300">
                            {entry.sentence}
                        </p>
                    </div>

                    {/* State */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Learning State
                        </label>
                        {isEditing ? (
                            <select
                                value={state}
                                onChange={(e) => setState(e.target.value as WordState)}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                            >
                                {stateOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <div className="flex items-center gap-2">
                                <span
                                    className={`h-3 w-3 rounded-full ${stateOptions.find((o) => o.value === entry.state)?.color
                                        }`}
                                />
                                <span className="text-gray-900 dark:text-gray-100">
                                    {stateOptions.find((o) => o.value === entry.state)?.label}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Metadata */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Added: </span>
                            <span className="text-gray-900 dark:text-gray-100">
                                {new Date(entry.createdAt).toLocaleDateString('en-AU', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                })}
                            </span>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Review Count: </span>
                            <span className="text-gray-900 dark:text-gray-100">{entry.reviewCount}</span>
                        </div>
                        {entry.pushedToAnki && (
                            <div className="col-span-2">
                                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                                    Synced to Anki
                                    {entry.ankiNoteId && ` (Note #${entry.ankiNoteId})`}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-700">
                    <button
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                    </button>

                    <div className="flex gap-2">
                        {isEditing ? (
                            <>
                                <button
                                    onClick={() => {
                                        setIsEditing(false);
                                        setTranslation(entry.translation);
                                        setState(entry.state);
                                    }}
                                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {isSaving ? 'Saving...' : 'Save'}
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                Edit
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}