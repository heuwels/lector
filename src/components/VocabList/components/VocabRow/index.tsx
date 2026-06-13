"use client";

import AnkiStatus from "@/components/AnkiStatus";
import StateIndicator from "@/components/StateIndicator";
import { VocabRowProps } from "./types";

export default function VocabRow({
    entry,
    bookTitle,
    isSelected,
    onSelect,
    onClick,
}: VocabRowProps) {
    const formattedDate = new Date(entry.createdAt).toLocaleDateString("en-AU", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });

    return (
        <tr
            className="cursor-pointer border-b border-gray-200 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            onClick={() => onClick(entry)}
        >
            {/* Checkbox */}
            <td className="w-12 px-4 py-3">
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                        e.stopPropagation();
                        onSelect(entry.id, e.target.checked);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                />
            </td>

            {/* Word/Phrase */}
            <td className="px-4 py-3">
                <div className="flex flex-col">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                        {entry.text}
                    </span>
                    {entry.type === "phrase" && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            phrase
                        </span>
                    )}
                </div>
            </td>

            {/* Translation */}
            <td className="max-w-xs px-4 py-3">
                <span className="line-clamp-2 text-gray-700 dark:text-gray-300">
                    {entry.translation}
                </span>
            </td>

            {/* State */}
            <td className="px-4 py-3">
                <div className="flex items-center justify-center">
                    <StateIndicator state={entry.state} />
                </div>
            </td>

            <td className="max-w-[150px] px-4 py-3">
                <span className="line-clamp-1 text-sm text-gray-600 dark:text-gray-400">
                    {bookTitle || "-"}
                </span>
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                {formattedDate}
            </td>
            <td className="px-4 py-3">
                <AnkiStatus
                    pushedToAnki={entry.pushedToAnki}
                    ankiNoteId={entry.ankiNoteId}
                />
            </td>
        </tr>
    );
}
