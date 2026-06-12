import { ClozeSentence } from "@/types";
import { ROUND_SIZES } from "./constants";

// Fuzzy match status for live feedback
export type FuzzyStatus = 'empty' | 'match' | 'partial' | 'wrong';
export type PracticeState = 'setup' | 'loading' | 'practicing' | 'feedback' | 'complete' | 'empty';
export type PracticeMode = 'type' | 'mc';

export type RoundSize = typeof ROUND_SIZES[number];
export type RoundType = 'new' | 'review';


export interface CurrentSentence {
  sentence: ClozeSentence;
  blankedSentence: string;
}