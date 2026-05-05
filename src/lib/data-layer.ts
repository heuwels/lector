/**
 * Data Layer - Server-side storage via API routes
 *
 * This module provides the same interface as db.ts but uses fetch() to call
 * the server-side API instead of browser-based IndexedDB/Dexie.
 */

import { DEFAULT_LANGUAGE } from './languages';

// Active language helper — reads from localStorage, falls back to default
export function getActiveLanguage(): string {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  return localStorage.getItem('lector-target-language') || DEFAULT_LANGUAGE;
}

function langParam(prefix: '?' | '&' = '?'): string {
  return `${prefix}language=${getActiveLanguage()}`;
}

// Re-export types from db.ts for compatibility
export type {
  WordState,
  VocabType,
  ClozeMasteryLevel,
  ClozeSource,
  ClozeCollection,
  Collection,
  CollectionGroup,
  Lesson,
  LessonSummary,
  VocabEntry,
  KnownWord,
  ClozeSentence,
  DailyStats,
  Settings,
} from './db';

import type {
  WordState,
  Collection,
  CollectionGroup,
  Lesson,
  LessonSummary,
  VocabEntry,
  KnownWord,
  ClozeSentence,
  DailyStats,
  ClozeCollection,
  ClozeMasteryLevel,
} from './db';

// ============================================================================
// Helper Functions - Collections
// ============================================================================

export async function getAllCollections(): Promise<Collection[]> {
  const res = await fetch(`/api/collections${langParam()}`);
  return res.json();
}

export async function getCollection(id: string): Promise<Collection | undefined> {
  const res = await fetch(`/api/collections/${id}`);
  if (!res.ok) return undefined;
  return res.json();
}

export async function createCollection(data: { title: string; author?: string }): Promise<string> {
  const res = await fetch('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, language: getActiveLanguage() }),
  });
  const { id } = await res.json();
  return id;
}

export async function deleteCollection(id: string): Promise<void> {
  await fetch(`/api/collections/${id}`, { method: 'DELETE' });
}

export async function updateCollection(id: string, data: { title?: string; author?: string; groupId?: string | null }): Promise<void> {
  await fetch(`/api/collections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ============================================================================
// Helper Functions - Groups
// ============================================================================

export async function getAllGroups(): Promise<CollectionGroup[]> {
  const res = await fetch('/api/groups');
  return res.json();
}

export async function createGroup(name: string): Promise<string> {
  const res = await fetch('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const { id } = await res.json();
  return id;
}

export async function updateGroup(id: string, data: { name?: string; sortOrder?: number }): Promise<void> {
  await fetch(`/api/groups/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteGroup(id: string): Promise<void> {
  await fetch(`/api/groups/${id}`, { method: 'DELETE' });
}

// ============================================================================
// Helper Functions - Lessons
// ============================================================================

export async function getLessonsForCollection(collectionId: string): Promise<LessonSummary[]> {
  const res = await fetch(`/api/collections/${collectionId}/lessons`);
  return res.json();
}

export async function getLesson(id: string): Promise<Lesson | undefined> {
  const res = await fetch(`/api/lessons/${id}`);
  if (!res.ok) return undefined;
  return res.json();
}

export async function addLessonToCollection(
  collectionId: string,
  data: { title: string; textContent: string }
): Promise<string> {
  const res = await fetch(`/api/collections/${collectionId}/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const { id } = await res.json();
  return id;
}

export async function deleteLesson(id: string): Promise<void> {
  await fetch(`/api/lessons/${id}`, { method: 'DELETE' });
}

export async function updateLessonProgress(
  id: string,
  progress: { scrollPosition?: number; percentComplete?: number }
): Promise<void> {
  await fetch(`/api/lessons/${id}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(progress),
  });
}

export async function importEpub(file: File): Promise<{
  collectionId: string;
  title: string;
  author: string;
  lessonCount: number;
}> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('language', getActiveLanguage());
  const res = await fetch('/api/import/epub', {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to import EPUB');
  }
  return res.json();
}

export async function createStandaloneLesson(data: {
  title: string;
  author: string;
  textContent: string;
}): Promise<{ collectionId: string; lessonId: string }> {
  // Create a collection with a single lesson
  const collectionId = await createCollection({ title: data.title, author: data.author });
  const res = await fetch(`/api/collections/${collectionId}/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: data.title, textContent: data.textContent }),
  });
  const { id: lessonId } = await res.json();
  return { collectionId, lessonId };
}

// ============================================================================
// Helper Functions - Vocabulary
// ============================================================================

export async function getAllVocab(): Promise<VocabEntry[]> {
  const res = await fetch(`/api/vocab${langParam()}`);
  const vocab = await res.json();
  return vocab.map((v: Record<string, unknown>) => ({
    ...v,
    stateUpdatedAt: new Date(v.stateUpdatedAt as string),
    createdAt: new Date(v.createdAt as string),
  }));
}

export async function getVocabEntry(id: string): Promise<VocabEntry | undefined> {
  const res = await fetch(`/api/vocab/${id}`);
  if (!res.ok) return undefined;
  const data = await res.json();
  return {
    ...data,
    stateUpdatedAt: new Date(data.stateUpdatedAt),
    createdAt: new Date(data.createdAt),
  };
}

export async function getVocabByText(text: string): Promise<VocabEntry | undefined> {
  const res = await fetch(`/api/vocab${langParam()}&text=${encodeURIComponent(text)}`);
  const vocab = await res.json();
  const match = vocab.find((v: VocabEntry) => v.text === text);
  if (!match) return undefined;
  return {
    ...match,
    stateUpdatedAt: new Date(match.stateUpdatedAt),
    createdAt: new Date(match.createdAt),
  };
}

export async function saveVocab(entry: VocabEntry): Promise<string> {
  const res = await fetch('/api/vocab', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...entry, language: getActiveLanguage() }),
  });
  const { id } = await res.json();
  return id;
}

export async function updateVocabState(id: string, state: WordState): Promise<void> {
  await fetch(`/api/vocab/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
}

export async function getVocabByState(state: WordState): Promise<VocabEntry[]> {
  const res = await fetch(`/api/vocab${langParam()}&state=${state}`);
  const vocab = await res.json();
  return vocab.map((v: Record<string, unknown>) => ({
    ...v,
    stateUpdatedAt: new Date(v.stateUpdatedAt as string),
    createdAt: new Date(v.createdAt as string),
  }));
}

export async function getVocabForBook(bookId: string): Promise<VocabEntry[]> {
  const res = await fetch(`/api/vocab${langParam()}&bookId=${bookId}`);
  const vocab = await res.json();
  return vocab.map((v: Record<string, unknown>) => ({
    ...v,
    stateUpdatedAt: new Date(v.stateUpdatedAt as string),
    createdAt: new Date(v.createdAt as string),
  }));
}

export async function getUnpushedVocab(): Promise<VocabEntry[]> {
  const res = await fetch(`/api/vocab${langParam()}&unpushed=true`);
  const vocab = await res.json();
  return vocab.map((v: Record<string, unknown>) => ({
    ...v,
    stateUpdatedAt: new Date(v.stateUpdatedAt as string),
    createdAt: new Date(v.createdAt as string),
  }));
}

export async function markVocabPushedToAnki(id: string, ankiNoteId: number): Promise<number> {
  const res = await fetch(`/api/vocab/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pushedToAnki: true, ankiNoteId }),
  });
  return res.ok ? 1 : 0;
}

export async function deleteVocabEntry(id: string): Promise<void> {
  await fetch(`/api/vocab/${id}`, { method: 'DELETE' });
}

// ============================================================================
// Helper Functions - Known Words (Fast Lookup)
// ============================================================================

export async function getWordState(word: string): Promise<WordState | undefined> {
  const map = await getKnownWordsMap();
  return map.get(word.toLowerCase());
}

export async function updateWordState(word: string, state: WordState): Promise<void> {
  await fetch('/api/known-words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates: [{ word: word.toLowerCase(), state }], language: getActiveLanguage() }),
  });
}

export async function getKnownWordsMap(): Promise<Map<string, WordState>> {
  const res = await fetch(`/api/known-words${langParam()}`);
  const data = await res.json();
  return new Map(Object.entries(data) as [string, WordState][]);
}

export async function getAllKnownWords(): Promise<KnownWord[]> {
  const res = await fetch(`/api/known-words${langParam()}`);
  const data = await res.json();
  return Object.entries(data).map(([word, state]) => ({ word, state: state as WordState }));
}

export async function bulkUpdateWordStates(
  updates: Array<{ word: string; state: WordState }>
): Promise<void> {
  await fetch('/api/known-words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates, language: getActiveLanguage() }),
  });
}

// ============================================================================
// Helper Functions - Cloze Sentences
// ============================================================================

export async function getClozeSentence(id: string): Promise<ClozeSentence | undefined> {
  const res = await fetch(`/api/cloze/${id}${langParam()}`);
  if (!res.ok) return undefined;
  const data = await res.json();
  return {
    ...data,
    nextReview: new Date(data.nextReview),
    lastReviewed: data.lastReviewed ? new Date(data.lastReviewed) : undefined,
  };
}

export async function saveClozeSentence(sentence: ClozeSentence): Promise<string> {
  const res = await fetch('/api/cloze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...sentence,
      nextReview: sentence.nextReview.toISOString(),
      lastReviewed: sentence.lastReviewed?.toISOString(),
      language: getActiveLanguage(),
    }),
  });
  const { id } = await res.json();
  return id;
}

export async function getClozeSentencesDueForReview(limit: number = 20): Promise<ClozeSentence[]> {
  const res = await fetch(`/api/cloze/due?limit=${limit}${langParam('&')}`);
  const sentences = await res.json();
  return sentences.map((s: Record<string, unknown>) => ({
    ...s,
    nextReview: new Date(s.nextReview as string),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed as string) : undefined,
  }));
}

export async function updateClozeAfterReview(
  id: string,
  correct: boolean,
  newMasteryLevel: ClozeMasteryLevel,
  nextReview: Date
): Promise<number> {
  const res = await fetch(`/api/cloze/${id}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      correct,
      masteryLevel: newMasteryLevel,
      nextReview: nextReview.toISOString(),
    }),
  });
  return res.ok ? 1 : 0;
}

export async function getAllClozeSentences(): Promise<ClozeSentence[]> {
  const res = await fetch(`/api/cloze${langParam()}&limit=10000`);
  const sentences = await res.json();
  return sentences.map((s: Record<string, unknown>) => ({
    ...s,
    nextReview: new Date(s.nextReview as string),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed as string) : undefined,
  }));
}

export async function getClozeSentenceByTatoebaId(tatoebaSentenceId: number): Promise<ClozeSentence | undefined> {
  const all = await getAllClozeSentences();
  return all.find(s => s.tatoebaSentenceId === tatoebaSentenceId);
}

export async function getClozeSentencesForWord(word: string): Promise<ClozeSentence[]> {
  const res = await fetch(`/api/cloze${langParam()}&word=${encodeURIComponent(word)}`);
  const sentences = await res.json();
  return sentences.map((s: Record<string, unknown>) => ({
    ...s,
    nextReview: new Date(s.nextReview as string),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed as string) : undefined,
  }));
}

export async function bulkSaveClozeSentences(sentences: ClozeSentence[]): Promise<void> {
  await fetch('/api/cloze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sentences.map(s => ({
      ...s,
      nextReview: s.nextReview.toISOString(),
      lastReviewed: s.lastReviewed?.toISOString(),
      language: getActiveLanguage(),
    }))),
  });
}

export async function seedSentenceBank(): Promise<{ seeded: number; total: number }> {
  const res = await fetch('/api/cloze/seed', { method: 'POST' });
  return res.json();
}

export async function blacklistClozeSentence(id: string): Promise<void> {
  await fetch(`/api/cloze/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blacklisted: 1 }),
  });
}

export async function getClozeSentencesByCollection(
  collection: ClozeCollection,
  limit: number = 20,
  excludeWords: string[] = []
): Promise<ClozeSentence[]> {
  const params = new URLSearchParams({
    collection,
    limit: limit.toString(),
    mode: 'review',
  });
  if (excludeWords.length > 0) {
    params.set('excludeWords', excludeWords.join(','));
  }

  params.set('language', getActiveLanguage());
  const res = await fetch(`/api/cloze/due?${params}`);
  const sentences = await res.json();
  return sentences.map((s: Record<string, unknown>) => ({
    ...s,
    nextReview: new Date(s.nextReview as string),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed as string) : undefined,
  }));
}

export async function getNewSentencesByCollection(
  collection: ClozeCollection,
  limit: number = 20,
  excludeWords: string[] = []
): Promise<ClozeSentence[]> {
  const params = new URLSearchParams({
    collection,
    limit: limit.toString(),
    mode: 'new',
  });
  if (excludeWords.length > 0) {
    params.set('excludeWords', excludeWords.join(','));
  }

  params.set('language', getActiveLanguage());
  const res = await fetch(`/api/cloze/due?${params}`);
  const sentences = await res.json();
  return sentences.map((s: Record<string, unknown>) => ({
    ...s,
    nextReview: new Date(s.nextReview as string),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed as string) : undefined,
  }));
}

export async function getCollectionCounts(): Promise<Record<ClozeCollection, { total: number; due: number; mastered: number }>> {
  const res = await fetch(`/api/cloze/counts${langParam()}`);
  return res.json();
}

export async function getStreak(): Promise<{ streak: number; practicedToday: boolean }> {
  const res = await fetch(`/api/stats/streak${langParam()}`);
  return res.json();
}

export interface FluencyStats {
  totalKnownWords: number;
  totalLearning: number;
  totalNew: number;
  estimatedLevel: {
    code: string;
    label: string;
  };
  progressToNextLevel: number;
  weeklyGrowth: {
    thisWeek: number;
    lastWeek: number;
    delta: number;
  };
}

export async function getFluencyStats(): Promise<FluencyStats> {
  const res = await fetch(`/api/stats/fluency${langParam()}`);
  return res.json();
}

// Migration function - no-op for server storage
export async function migrateClozeSentences(): Promise<number> {
  return 0;
}

// ============================================================================
// Helper Functions - Journal
// ============================================================================

export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
  type: 'grammar' | 'spelling' | 'word_choice' | 'word_order' | 'missing_word' | 'extra_word';
}

export interface JournalEntry {
  id: string;
  body: string;
  correctedBody: string | null;
  corrections: Correction[] | null;
  status: 'draft' | 'submitted';
  wordCount: number;
  entryDate: string;
  createdAt: string;
  updatedAt: string;
}

export async function getJournalEntries(limit: number = 20, offset: number = 0): Promise<JournalEntry[]> {
  const res = await fetch(`/api/journal?limit=${limit}&offset=${offset}${langParam('&')}`);
  return res.json();
}

export async function getJournalEntriesByDate(date: string): Promise<JournalEntry[]> {
  const res = await fetch(`/api/journal?date=${date}${langParam('&')}`);
  return res.json();
}

export async function getJournalEntry(id: string): Promise<JournalEntry | undefined> {
  const res = await fetch(`/api/journal/${id}`);
  if (!res.ok) return undefined;
  return res.json();
}

export async function createJournalEntry(body: string, entryDate?: string): Promise<{ id: string; entryDate: string }> {
  const res = await fetch('/api/journal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, entryDate, language: getActiveLanguage() }),
  });
  return res.json();
}

export async function updateJournalDraft(id: string, body: string): Promise<void> {
  await fetch(`/api/journal/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

export async function submitJournalForCorrection(id: string): Promise<{ correctedBody: string; corrections: Correction[] }> {
  const res = await fetch(`/api/journal/${id}/correct`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Correction failed');
  }
  return res.json();
}

export async function deleteJournalEntry(id: string): Promise<void> {
  await fetch(`/api/journal/${id}`, { method: 'DELETE' });
}

// ============================================================================
// Helper Functions - Daily Stats
// ============================================================================

export async function getDailyStats(date: string): Promise<DailyStats | undefined> {
  const res = await fetch(`/api/stats?startDate=${date}&endDate=${date}${langParam('&')}`);
  const stats = await res.json();
  return stats[0];
}

export async function getTodayStats(): Promise<DailyStats> {
  const res = await fetch(`/api/stats/today${langParam()}`);
  return res.json();
}

export async function incrementDailyStat(
  field: keyof Omit<DailyStats, 'date'>,
  amount: number = 1
): Promise<void> {
  await fetch(`/api/stats/today${langParam()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, amount }),
  });
}

export async function getStatsForDateRange(
  startDate: string,
  endDate: string
): Promise<DailyStats[]> {
  const res = await fetch(`/api/stats?startDate=${startDate}&endDate=${endDate}${langParam('&')}`);
  return res.json();
}

export async function getRecentStats(days: number = 7): Promise<DailyStats[]> {
  const res = await fetch(`/api/stats?days=${days}${langParam('&')}`);
  return res.json();
}

// ============================================================================
// Helper Functions - Settings
// ============================================================================

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const res = await fetch(`/api/settings/${key}`);
  if (!res.ok) return undefined;
  return res.json();
}

export async function setSetting<T>(key: string, value: T): Promise<string> {
  await fetch(`/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  return key;
}

export async function deleteSetting(key: string): Promise<void> {
  await fetch(`/api/settings/${key}`, { method: 'DELETE' });
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const res = await fetch('/api/settings');
  return res.json();
}

// ============================================================================
// Helper Functions - API Tokens
// ============================================================================

export interface ApiTokenMeta {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface ApiTokenCreateResponse extends ApiTokenMeta {
  token: string;
}

export async function getApiTokens(): Promise<ApiTokenMeta[]> {
  const res = await fetch('/api/tokens');
  return res.json();
}

export async function createApiToken(data: {
  name: string;
  scopes: string[];
  expiresAt?: string;
}): Promise<ApiTokenCreateResponse> {
  const res = await fetch('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create token');
  }
  return res.json();
}

export async function revokeApiToken(id: string): Promise<void> {
  await fetch(`/api/tokens/${id}`, { method: 'DELETE' });
}

// ============================================================================
// Utility Functions
// ============================================================================

export async function clearAllData(): Promise<void> {
  console.warn('clearAllData not implemented for server storage');
}

export async function exportAllData(): Promise<{
  collections: Collection[];
  vocab: VocabEntry[];
  knownWords: KnownWord[];
  clozeSentences: ClozeSentence[];
  dailyStats: DailyStats[];
  settings: unknown[];
}> {
  const res = await fetch('/api/data');
  return res.json();
}

export async function getVocabStats(): Promise<{
  total: number;
  byState: Record<WordState, number>;
}> {
  const res = await fetch(`/api/vocab${langParam()}`);
  const vocab = await res.json();

  const byState: Record<WordState, number> = {
    new: 0,
    level1: 0,
    level2: 0,
    level3: 0,
    level4: 0,
    known: 0,
    ignored: 0,
  };

  vocab.forEach((v: VocabEntry) => {
    byState[v.state]++;
  });

  return {
    total: vocab.length,
    byState,
  };
}

// ============================================================================
// Import from Dexie backup
// ============================================================================

export async function importFromDexie(data: Record<string, unknown[]>): Promise<{
  success: boolean;
  imported: Record<string, number>;
}> {
  const res = await fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

// ============================================================================
// Helper Functions - Chat
// ============================================================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  provider: string | null;
  createdAt: string;
}

export async function getChatMessages(limit: number = 50, before?: string): Promise<ChatMessage[]> {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (before) params.set('before', before);
  const res = await fetch(`/api/chat?${params}`);
  return res.json();
}

export async function sendChatMessage(message: string): Promise<{
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to send message');
  }
  return res.json();
}

export async function clearChatMessages(): Promise<void> {
  await fetch('/api/chat', { method: 'DELETE' });
}
