import { darkColorScheme } from "./theme";

const defaultColorScheme = darkColorScheme;

export function getColor(count: number, maxCount: number, scheme: typeof defaultColorScheme): string {
    if (count === 0) { return scheme.empty; }

    const ratio = count / maxCount;

    if (ratio <= 0.25) { return scheme.level1; }
    if (ratio <= 0.5) { return scheme.level2; }
    if (ratio <= 0.75) { return scheme.level3; }

    return scheme.level4;
}


export function formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
}