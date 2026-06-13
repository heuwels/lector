import { WordState } from "@/types";

export const stateColors: Record<WordState, string> = {
    new: 'bg-blue-100',
    level1: 'bg-yellow-300',
    level2: 'bg-yellow-200',
    level3: 'bg-yellow-100',
    level4: 'bg-yellow-50',
    known: '',
    ignored: 'opacity-50',
};

export const darkStateColors: Record<WordState, string> = {
    new: 'bg-blue-900/40',
    level1: 'bg-yellow-700/50',
    level2: 'bg-yellow-800/40',
    level3: 'bg-yellow-900/30',
    level4: 'bg-yellow-900/20',
    known: '',
    ignored: 'opacity-40',
};