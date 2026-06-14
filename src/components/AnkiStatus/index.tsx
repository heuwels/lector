export default function AnkiStatus({
    pushedToAnki,
    ankiNoteId,
}: {
    pushedToAnki: boolean;
    ankiNoteId?: number;
}) {
    if (pushedToAnki) {
        return (
            <span
                className="inline-flex items-center rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-xs font-medium text-primary"
                title={ankiNoteId ? `Anki Note ID: ${ankiNoteId}` : "Pushed to Anki"}
            >
                Synced
            </span>
        );
    }
    return (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Not synced
        </span>
    );
}