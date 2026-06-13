import { WordState } from "@/types";

export default function StateIndicator({ state }: { state: WordState }) {
    switch (state) {
        case "new":
            return (
                <span
                    className="inline-block h-3 w-3 rounded-full bg-gray-400 dark:bg-gray-500"
                    title="New - Not yet studied"
                />
            );
        case "level1":
            return (
                <span
                    className="inline-block h-3 w-3 rounded-full bg-blue-800"
                    title="Level 1 - Just started learning"
                />
            );
        case "level2":
            return (
                <span
                    className="inline-block h-3 w-3 rounded-full bg-blue-600"
                    title="Level 2 - Learning"
                />
            );
        case "level3":
            return (
                <span
                    className="inline-block h-3 w-3 rounded-full bg-blue-400"
                    title="Level 3 - Familiar"
                />
            );
        case "level4":
            return (
                <span
                    className="inline-block h-3 w-3 rounded-full bg-blue-200"
                    title="Level 4 - Almost known"
                />
            );
        case "known":
            return (
                <svg
                    className="h-4 w-4 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                    role="img"
                    aria-label="Known"
                >
                    <title>Known - Fully learned</title>
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                    />
                </svg>
            );
        case "ignored":
            return (
                <span
                    className="inline-block h-0.5 w-3 rounded bg-gray-400"
                    title="Ignored - Hidden from study"
                />
            );
        default:
            return null;
    }
}