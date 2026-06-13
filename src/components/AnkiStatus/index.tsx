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
                className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200"
                title={ankiNoteId ? `Anki Note ID: ${ankiNoteId}` : "Pushed to Anki"}
            >
                Synced
            </span>
        );
    }
    return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            Not synced
        </span>
    );
}