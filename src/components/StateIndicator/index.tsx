import { Check } from "lucide-react";
import { WordState } from "@/types";

export default function StateIndicator({ state }: { state: WordState }) {
    switch (state) {
        case "new":
            return (
                <span
                    className="inline-block h-3 w-3 rounded-full bg-[var(--w-new-bd)]"
                    title="New - Not yet studied"
                />
            );
        case "level1":
            return (
                <span
                    className="inline-block h-3 w-3 rounded-full bg-[var(--w-l1-bd)]"
                    title="Level 1 - Just started learning"
                />
            );
        case "level2":
            return (
                <span
                    className="inline-block h-3 w-3 rounded-full bg-[var(--w-l2-bd)]"
                    title="Level 2 - Learning"
                />
            );
        case "level3":
            return (
                <span
                    className="inline-block h-3 w-3 rounded-full bg-[var(--w-l3-bd)]"
                    title="Level 3 - Familiar"
                />
            );
        case "level4":
            return (
                <span
                    className="inline-block h-3 w-3 rounded-full bg-[var(--w-l4-bd)]"
                    title="Level 4 - Almost known"
                />
            );
        case "known":
            return (
                <Check className="h-4 w-4 text-primary" strokeWidth={3} aria-label="Known">
                    <title>Known - Fully learned</title>
                </Check>
            );
        case "ignored":
            return (
                <span
                    className="inline-block h-0.5 w-3 rounded bg-muted-foreground"
                    title="Ignored - Hidden from study"
                />
            );
        default:
            return null;
    }
}