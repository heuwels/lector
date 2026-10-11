import { ClozeCollection } from '@/types';

export const ANKI_CLOZE_DECK_SETTING_KEY = 'lector-anki-cloze-deck';
export const ROUND_SIZES = [10, 20, 30, 40, 50] as const;

export const COLLECTION_LABELS: Record<string, string> = {
  top500: 'Top 500',
  top1000: '500-1000',
  top2000: '1000-2000',
};

export const VISIBLE_COLLECTIONS: ClozeCollection[] = ['top500', 'top1000', 'top2000'];

// --- Dictation mode ---------------------------------------------------------

// localStorage key for the chosen practice format (cloze | dictation).
export const PRACTICE_FORMAT_SETTING_KEY = 'lector-practice-format';

// Fraction of the sentence's words that must be correct for a dictation attempt
// to count as a pass (advances the SRS card). Below this, the card hard-resets,
// matching cloze's "a miss resets mastery" rule. 0.75 lets a single slip through
// on the short (4–6 word) starter sentences while still failing a genuine miss.
export const DICTATION_PASS_THRESHOLD = 0.75;

// Base points for a perfect dictation at mastery 25 (scaled by mastery reached
// and accuracy). Higher than cloze typing (8) because transcribing a whole
// sentence from audio is harder than filling one blank.
export const DICTATION_POINTS_BASE = 12;

// How many times the learner may replay the audio ("Listen Again") before the
// control locks — the sentence is revealed on submit regardless.
export const DICTATION_MAX_REPLAYS = 3;

// Playback speed multipliers offered during dictation (× the normal TTS rate).
export const DICTATION_SPEEDS = [1, 0.75, 0.5] as const;

// SRS level settings for the new 1-7 SRS Review mode
export const SRS_LEVELS = [1, 2, 3, 4, 5, 6, 7] as const;
export const SRS_DEFAULT_LEVELS = [1, 2, 3] as const;
export const SRS_LEVEL_LABELS: Record<number, string> = {
  1: 'Level 1 (0 days)',
  2: 'Level 2 (1 day)',
  3: 'Level 3 (3 days)',
  4: 'Level 4 (7 days)',
  5: 'Level 5 (14 days)',
  6: 'Level 6 (30 days)',
  7: 'Level 7 (90 days)',
};
