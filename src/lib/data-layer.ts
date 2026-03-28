/**
 * Data Layer - Server-side storage via API routes
 *
 * This module provides the same interface as db.ts but uses fetch() to call
 * the server-side API instead of browser-based IndexedDB/Dexie.
 *
 * To migrate: change imports from '@/lib/db' to '@/lib/data-layer'
 */

// Re-export types from db.ts for compatibility
export type {
  WordState,
  VocabType,
  ClozeMasteryLevel,
  ClozeSource,
  ClozeCollection,
  BookFileType,
  BookProgress,
  Book,
  VocabEntry,
  KnownWord,
  ClozeSentence,
  DailyStats,
  Settings,
} from './db';

import type {
  WordState,
  Book,
  BookProgress,
  VocabEntry,
  KnownWord,
  ClozeSentence,
  DailyStats,
  ClozeCollection,
  ClozeMasteryLevel,
} from './db';

// ============================================================================
// Helper Functions - Books
// ============================================================================

export async function getBook(id: string): Promise<Book | undefined> {
  const res = await fetch(`/api/books/${id}`);
  if (!res.ok) return undefined;
  const data = await res.json();

  // Fetch file data if needed
  if (data.fileType !== 'markdown') {
    const fileRes = await fetch(`/api/books/${id}/file`);
    if (fileRes.ok) {
      data.fileData = await fileRes.arrayBuffer();
    }
  }

  return {
    ...data,
    createdAt: new Date(data.createdAt),
    lastReadAt: new Date(data.lastReadAt),
  };
}

export async function getAllBooks(): Promise<Book[]> {
  const res = await fetch('/api/books');
  const books = await res.json();
  return books.map((b: Record<string, unknown>) => ({
    ...b,
    createdAt: new Date(b.createdAt as string),
    lastReadAt: new Date(b.lastReadAt as string),
  }));
}

export async function saveBook(book: Omit<Book, 'createdAt' | 'lastReadAt'> & { fileData?: ArrayBuffer }): Promise<string> {
  const formData = new FormData();

  if (book.fileData) {
    formData.append('file', new Blob([book.fileData]));
  }
  formData.append('title', book.title);
  formData.append('author', book.author);
  formData.append('fileType', book.fileType);
  if (book.textContent) {
    formData.append('textContent', book.textContent);
  }

  const res = await fetch('/api/books', {
    method: 'POST',
    body: formData,
  });
  const { id } = await res.json();
  return id;
}

export async function deleteBook(id: string): Promise<void> {
  await fetch(`/api/books/${id}`, { method: 'DELETE' });
}

export async function updateBookProgress(id: string, progress: BookProgress): Promise<number> {
  const res = await fetch(`/api/books/${id}/progress`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(progress),
  });
  return res.ok ? 1 : 0;
}

export async function saveReadingPosition(
  bookId: string,
  cfi: string,
  chapter: number,
  percentage: number
): Promise<void> {
  await updateBookProgress(bookId, {
    chapter,
    scrollPosition: 0,
    percentComplete: percentage,
  });

  // Also store CFI in settings
  await setSetting(`reading-position-${bookId}`, {
    cfi,
    chapter,
    percentage,
    updatedAt: new Date().toISOString(),
  });
}

export async function getReadingPosition(bookId: string): Promise<{
  cfi: string;
  chapter: number;
  percentage: number;
} | null> {
  const result = await getSetting<{
    cfi: string;
    chapter: number;
    percentage: number;
  }>(`reading-position-${bookId}`);
  return result ?? null;
}

// ============================================================================
// Helper Functions - Vocabulary
// ============================================================================

export async function getAllVocab(): Promise<VocabEntry[]> {
  const res = await fetch('/api/vocab');
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
  const res = await fetch(`/api/vocab?text=${encodeURIComponent(text)}`);
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
    body: JSON.stringify(entry),
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
  const res = await fetch(`/api/vocab?state=${state}`);
  const vocab = await res.json();
  return vocab.map((v: Record<string, unknown>) => ({
    ...v,
    stateUpdatedAt: new Date(v.stateUpdatedAt as string),
    createdAt: new Date(v.createdAt as string),
  }));
}

export async function getVocabForBook(bookId: string): Promise<VocabEntry[]> {
  const res = await fetch(`/api/vocab?bookId=${bookId}`);
  const vocab = await res.json();
  return vocab.map((v: Record<string, unknown>) => ({
    ...v,
    stateUpdatedAt: new Date(v.stateUpdatedAt as string),
    createdAt: new Date(v.createdAt as string),
  }));
}

export async function getUnpushedVocab(): Promise<VocabEntry[]> {
  const res = await fetch('/api/vocab?unpushed=true');
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
    body: JSON.stringify({ updates: [{ word: word.toLowerCase(), state }] }),
  });
}

export async function getKnownWordsMap(): Promise<Map<string, WordState>> {
  const res = await fetch('/api/known-words');
  const data = await res.json();
  return new Map(Object.entries(data) as [string, WordState][]);
}

export async function getAllKnownWords(): Promise<KnownWord[]> {
  const res = await fetch('/api/known-words');
  const data = await res.json();
  return Object.entries(data).map(([word, state]) => ({ word, state: state as WordState }));
}

export async function bulkUpdateWordStates(
  updates: Array<{ word: string; state: WordState }>
): Promise<void> {
  await fetch('/api/known-words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates }),
  });
}

// ============================================================================
// Helper Functions - Cloze Sentences
// ============================================================================

export async function getClozeSentence(id: string): Promise<ClozeSentence | undefined> {
  const res = await fetch(`/api/cloze/${id}`);
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
    }),
  });
  const { id } = await res.json();
  return id;
}

export async function getClozeSentencesDueForReview(limit: number = 20): Promise<ClozeSentence[]> {
  const res = await fetch(`/api/cloze/due?limit=${limit}`);
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
  const res = await fetch('/api/cloze?limit=10000');
  const sentences = await res.json();
  return sentences.map((s: Record<string, unknown>) => ({
    ...s,
    nextReview: new Date(s.nextReview as string),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed as string) : undefined,
  }));
}

export async function getClozeSentenceByTatoebaId(tatoebaSentenceId: number): Promise<ClozeSentence | undefined> {
  // Note: This is a simple check - for better performance, add a dedicated API endpoint
  const all = await getAllClozeSentences();
  return all.find(s => s.tatoebaSentenceId === tatoebaSentenceId);
}

export async function getClozeSentencesForWord(word: string): Promise<ClozeSentence[]> {
  const res = await fetch(`/api/cloze?word=${encodeURIComponent(word)}`);
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
    }))),
  });
}

// Seed the cloze database from the static sentence bank (no-op if already seeded)
export async function seedSentenceBank(): Promise<{ seeded: number; total: number }> {
  const check = await fetch('/api/cloze/seed');
  const { needsSeed } = await check.json();
  if (!needsSeed) return { seeded: 0, total: 0 };

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
  });
  if (excludeWords.length > 0) {
    params.set('excludeWords', excludeWords.join(','));
  }

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
  // For new sentences, we'd need a different endpoint or filter
  // For now, use the regular endpoint with collection filter
  return getClozeSentencesByCollection(collection, limit, excludeWords);
}

export async function getCollectionCounts(): Promise<Record<ClozeCollection, { total: number; due: number; mastered: number }>> {
  const res = await fetch('/api/cloze/counts');
  return res.json();
}

export async function getStreak(): Promise<{ streak: number; practicedToday: boolean }> {
  const res = await fetch('/api/stats/streak');
  return res.json();
}

// Migration function - no-op for server storage
export async function migrateClozeSentences(): Promise<number> {
  return 0;
}

// ============================================================================
// Helper Functions - Daily Stats
// ============================================================================

export async function getDailyStats(date: string): Promise<DailyStats | undefined> {
  const res = await fetch(`/api/stats?startDate=${date}&endDate=${date}`);
  const stats = await res.json();
  return stats[0];
}

export async function getTodayStats(): Promise<DailyStats> {
  const res = await fetch('/api/stats/today');
  return res.json();
}

export async function incrementDailyStat(
  field: keyof Omit<DailyStats, 'date'>,
  amount: number = 1
): Promise<void> {
  await fetch('/api/stats/today', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, amount }),
  });
}

export async function getStatsForDateRange(
  startDate: string,
  endDate: string
): Promise<DailyStats[]> {
  const res = await fetch(`/api/stats?startDate=${startDate}&endDate=${endDate}`);
  return res.json();
}

export async function getRecentStats(days: number = 7): Promise<DailyStats[]> {
  const res = await fetch(`/api/stats?days=${days}`);
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
// Utility Functions
// ============================================================================

export async function clearAllData(): Promise<void> {
  // This would need a dedicated endpoint
  console.warn('clearAllData not implemented for server storage');
}

export async function exportAllData(): Promise<{
  books: Book[];
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
  const res = await fetch('/api/vocab');
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
