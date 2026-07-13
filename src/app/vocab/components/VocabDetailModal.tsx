import { X } from 'lucide-react';
import { useState } from 'react';
import { VocabEntry, WordState } from "@/types";
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';

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
        } catch {
            // The page-level mutation handler owns the error toast. Keep the
            // draft open for retry without leaking a rejected click promise.
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
        } catch {
            // The parent owns the error toast. Keep the modal open for retry.
        } finally {
            setIsDeleting(false);
        }
    };

    // State color classes for dropdown
    const stateOptions: { value: WordState; label: string; color: string }[] = [
        { value: 'new', label: 'New', color: 'bg-[var(--w-new-bd)]' },
        { value: 'level1', label: 'Level 1', color: 'bg-[var(--w-l1-bd)]' },
        { value: 'level2', label: 'Level 2', color: 'bg-[var(--w-l2-bd)]' },
        { value: 'level3', label: 'Level 3', color: 'bg-[var(--w-l3-bd)]' },
        { value: 'level4', label: 'Level 4', color: 'bg-[var(--w-l4-bd)]' },
        { value: 'known', label: 'Known', color: 'bg-primary' },
        { value: 'ignored', label: 'Ignored', color: 'bg-muted-foreground' },
    ];

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                data-testid="vocab-detail-modal"
                className="max-w-lg rounded-lg p-6"
            >
                {/* Header */}
                <div className="mb-4 flex items-start justify-between">
                    <div>
                        <DialogTitle className="text-xl font-bold">{entry.text}</DialogTitle>
                        <span className="text-sm text-muted-foreground">
                            {entry.type === 'phrase' ? 'Phrase' : 'Word'}
                        </span>
                    </div>
                    <DialogClose
                        className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label="Close"
                    >
                        <X className="h-6 w-6" />
                    </DialogClose>
                </div>

                {/* Content */}
                <div className="space-y-4">
                    {/* Translation */}
                    <div>
                        <label
                            htmlFor="vocab-translation"
                            className="mb-1 block text-sm font-medium text-foreground"
                        >
                            Translation
                        </label>
                        {isEditing ? (
                            <textarea
                                id="vocab-translation"
                                data-testid="vocab-translation-edit"
                                value={translation}
                                onChange={(e) => setTranslation(e.target.value)}
                                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
                                rows={2}
                            />
                        ) : (
                            <p className="text-foreground">{entry.translation}</p>
                        )}
                    </div>

                    {/* Context Sentence */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-foreground">
                            Context Sentence
                        </label>
                        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground italic">
                            {entry.sentence}
                        </p>
                    </div>

                    {/* State */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-foreground">
                            Learning State
                        </label>
                        {isEditing ? (
                            <select
                                value={state}
                                onChange={(e) => setState(e.target.value as WordState)}
                                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
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
                                <span className="text-foreground">
                                    {stateOptions.find((o) => o.value === entry.state)?.label}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Metadata */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-muted-foreground">Added: </span>
                            <span className="text-foreground">
                                {new Date(entry.createdAt).toLocaleDateString('en-AU', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                })}
                            </span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Review Count: </span>
                            <span className="text-foreground">{entry.reviewCount}</span>
                        </div>
                        {entry.pushedToAnki && (
                            <div className="col-span-2">
                                <span className="inline-flex items-center rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] px-2 py-0.5 text-xs font-medium text-primary">
                                    Synced to Anki
                                    {entry.ankiNoteId && ` (Note #${entry.ankiNoteId})`}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                    <Button
                        variant="destructive"
                        onClick={handleDelete}
                        disabled={isDeleting}
                    >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                    </Button>

                    <div className="flex gap-2">
                        {isEditing ? (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setIsEditing(false);
                                        setTranslation(entry.translation);
                                        setState(entry.state);
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                >
                                    {isSaving ? 'Saving...' : 'Save'}
                                </Button>
                            </>
                        ) : (
                            <Button onClick={() => setIsEditing(true)}>
                                Edit
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
