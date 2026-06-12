/**
 * Shared domain types for vocabulary, reading progress, and learning stats.
 * Server-side row shapes live in api/src/db.ts; these are the client-facing
 * shapes returned by the API routes and consumed via src/lib/data-layer.ts.
 */

export type WordState = 'new' | 'level1' | 'level2' | 'level3' | 'level4' | 'known' | 'ignored';
export type VocabType = 'word' | 'phrase';
export type ClozeMasteryLevel = 0 | 25 | 50 | 75 | 100;
export type ClozeSource = 'tatoeba' | 'mined';
export type ClozeCollection = 'top500' | 'top1000' | 'top2000' | 'mined' | 'random';

export interface Collection {
  id: string;
  title: string;
  author: string;
  coverUrl?: string;
  groupId?: string | null;
  groupName?: string | null;
  sortOrder?: number;
  language?: string;
  lessonCount: number;
  avgProgress: number;
  createdAt: string;
  lastReadAt: string;
}

export interface CollectionGroup {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
}

export interface Lesson {
  id: string;
  collectionId: string | null;
  title: string;
  sortOrder: number;
  textContent: string;
  progress_scrollPosition: number;
  progress_percentComplete: number;
  wordCount: number;
  language?: string;
  createdAt: string;
  lastReadAt: string;
}

export interface LessonSummary {
  id: string;
  collectionId: string | null;
  title: string;
  sortOrder: number;
  progress_scrollPosition: number;
  progress_percentComplete: number;
  wordCount: number;
  createdAt: string;
  lastReadAt: string;
}

export interface VocabEntry {
  id: string;
  text: string;
  type: VocabType;
  sentence: string;
  translation: string;
  state: WordState;
  stateUpdatedAt: Date;
  reviewCount: number;
  bookId?: string; // legacy — maps to lessonId
  chapter?: number;
  language?: string;
  createdAt: Date;
  pushedToAnki: boolean;
  ankiNoteId?: number;
}

export interface KnownWord {
  word: string;  // lowercase, normalized - primary key
  state: WordState;
}

export interface ClozeSentence {
  id: string;
  sentence: string;
  clozeWord: string;
  clozeIndex: number;
  translation: string;
  source: ClozeSource;
  collection: ClozeCollection;
  wordRank?: number;
  tatoebaSentenceId?: number;
  vocabEntryId?: string;
  masteryLevel: ClozeMasteryLevel;
  nextReview: Date;
  reviewCount: number;
  lastReviewed?: Date;
  timesCorrect: number;
  timesIncorrect: number;
}

export interface DailyStats {
  date: string;  // YYYY-MM-DD, primary key
  wordsRead: number;
  newWordsSaved: number;
  wordsMarkedKnown: number;
  minutesRead: number;
  clozePracticed: number;
  points: number;
  dictionaryLookups: number;
}

export interface Settings {
  key: string;  // primary key
  value: unknown;
}
