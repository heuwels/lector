import { ClozeCollection } from "@/types";

export const ANKI_CLOZE_DECK_SETTING_KEY = 'lector-anki-cloze-deck';
export const ROUND_SIZES = [10, 20, 30, 40, 50] as const;


export const COLLECTION_LABELS: Record<string, string> = {
  top500: 'Top 500',
  top1000: '500-1000',
  top2000: '1000-2000',
};

export const VISIBLE_COLLECTIONS: ClozeCollection[] = ['top500', 'top1000', 'top2000'];