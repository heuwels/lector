/**
 * Data Layer — persistence via the Hono API.
 *
 * All persistence goes through apiFetch() to the Hono API directly; the Next.js
 * `/api/*` proxy routes were removed in #188. Shared domain types live in
 * src/types.
 */

import { DEFAULT_LANGUAGE, foldWord, getLanguageConfig, isValidLanguageCode } from './languages';
import { apiFetch } from './api-base';
import { activeTenantId, readLanguageCache } from './language-cache';

// Active language helper — reads the tenant-keyed cache (#281), falls back
// to the default (SSR, cloud pre-session, or simply nothing cached yet).
export function getActiveLanguage(): string {
  return readLanguageCache() || DEFAULT_LANGUAGE;
}

/** The active language's full pack (non-hook twin of useActiveLanguage). */
export function getActivePack() {
  const code = getActiveLanguage();
  return getLanguageConfig(isValidLanguageCode(code) ? code : DEFAULT_LANGUAGE);
}

function langParam(prefix: '?' | '&' = '?'): string {
  return `${prefix}language=${getActiveLanguage()}`;
}

async function apiError(res: Response, fallback: string): Promise<Error> {
  const body = (await res
    .clone()
    .json()
    .catch(() => ({}))) as { error?: unknown };
  return new Error(typeof body.error === 'string' ? body.error : fallback);
}

// Re-export the shared domain types for convenience
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
} from '@/types';

export type { ReadingStats } from './stats-derive';

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
} from '@/types';

// ============================================================================
// Helper Functions - Collections
// ============================================================================

export async function getAllCollections(): Promise<Collection[]> {
  const res = await apiFetch(`/api/collections${langParam()}`);
  return res.json();
}

export async function getCollection(id: string): Promise<Collection | undefined> {
  const res = await apiFetch(`/api/collections/${id}`);
  if (!res.ok) return undefined;
  return res.json();
}

export async function createCollection(data: {
  title: string;
  author?: string;
  groupId?: string | null;
}): Promise<string> {
  const res = await apiFetch('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, language: getActiveLanguage() }),
  });
  if (!res.ok) throw await apiError(res, 'Could not create collection');
  const { id } = await res.json();
  return id;
}

export async function reorderCollections(ids: string[]): Promise<void> {
  await apiFetch('/api/collections/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export async function deleteCollection(id: string): Promise<void> {
  await apiFetch(`/api/collections/${id}`, { method: 'DELETE' });
}

export async function updateCollection(
  id: string,
  data: { title?: string; author?: string; groupId?: string | null },
): Promise<void> {
  await apiFetch(`/api/collections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ============================================================================
// Helper Functions - Groups
// ============================================================================

export async function getAllGroups(): Promise<CollectionGroup[]> {
  const res = await apiFetch('/api/groups');
  return res.json();
}

export async function createGroup(name: string): Promise<string> {
  const res = await apiFetch('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const { id } = await res.json();
  return id;
}

export async function updateGroup(
  id: string,
  data: { name?: string; sortOrder?: number },
): Promise<void> {
  await apiFetch(`/api/groups/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteGroup(id: string): Promise<void> {
  await apiFetch(`/api/groups/${id}`, { method: 'DELETE' });
}

// ============================================================================
// Helper Functions - Lessons
// ============================================================================

export async function getLessonsForCollection(collectionId: string): Promise<LessonSummary[]> {
  const res = await apiFetch(`/api/collections/${collectionId}/lessons`);
  return res.json();
}

export async function getLesson(id: string): Promise<Lesson | undefined> {
  const res = await apiFetch(`/api/lessons/${id}`);
  if (!res.ok) return undefined;
  return res.json();
}

export async function addLessonToCollection(
  collectionId: string,
  data: { title: string; textContent: string },
): Promise<string> {
  const res = await apiFetch(`/api/collections/${collectionId}/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await apiError(res, 'Could not create lesson');
  const { id } = await res.json();
  return id;
}

export async function updateLesson(
  id: string,
  data: { title?: string; textContent?: string },
): Promise<void> {
  await apiFetch(`/api/lessons/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteLesson(id: string): Promise<void> {
  await apiFetch(`/api/lessons/${id}`, { method: 'DELETE' });
}

export async function reorderLessons(collectionId: string, ids: string[]): Promise<void> {
  await apiFetch(`/api/collections/${collectionId}/lessons/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export async function updateLessonProgress(
  id: string,
  progress: { scrollPosition?: number; percentComplete?: number },
): Promise<void> {
  await apiFetch(`/api/lessons/${id}/progress`, {
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
  const res = await apiFetch('/api/import/epub', {
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
  const res = await apiFetch(`/api/collections/${collectionId}/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: data.title, textContent: data.textContent }),
  });
  if (!res.ok) {
    // The operation spans two legacy endpoints. If the authoritative lesson
    // limit rejects the second half, remove the collection created solely for
    // this import so a capped Free account does not accumulate empty shells.
    await apiFetch(`/api/collections/${collectionId}`, { method: 'DELETE' });
    throw await apiError(res, 'Could not create imported lesson');
  }
  const { id: lessonId } = await res.json();
  return { collectionId, lessonId };
}

// ============================================================================
// Helper Functions - Vocabulary
// ============================================================================

export async function getAllVocab(): Promise<VocabEntry[]> {
  const res = await apiFetch(`/api/vocab${langParam()}`);
  const vocab = await res.json();
  return vocab.map((v: Record<string, unknown>) => ({
    ...v,
    stateUpdatedAt: new Date(v.stateUpdatedAt as string),
    createdAt: new Date(v.createdAt as string),
  }));
}

export async function getVocabEntry(id: string): Promise<VocabEntry | undefined> {
  const res = await apiFetch(`/api/vocab/${id}`);
  if (!res.ok) return undefined;
  const data = await res.json();
  return {
    ...data,
    stateUpdatedAt: new Date(data.stateUpdatedAt),
    createdAt: new Date(data.createdAt),
  };
}

export async function getVocabByText(text: string): Promise<VocabEntry | undefined> {
  // The server filters by exact text (#240) — newest row first, so [0] matches
  // what the old client-side `.find()` over the DESC-ordered list returned.
  const res = await apiFetch(`/api/vocab${langParam()}&text=${encodeURIComponent(text)}`);
  const vocab = await res.json();
  const match = vocab[0];
  if (!match) return undefined;
  return {
    ...match,
    stateUpdatedAt: new Date(match.stateUpdatedAt),
    createdAt: new Date(match.createdAt),
  };
}

export async function saveVocab(entry: VocabEntry): Promise<string | null> {
  const res = await apiFetch('/api/vocab', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...entry, language: getActiveLanguage() }),
  });
  // null = not persisted (#232) — the reader's word-save handlers gate their
  // optimistic UI on this.
  if (!res.ok) return null;
  const { id } = await res.json();
  return id;
}

export async function updateVocabState(id: string, state: WordState): Promise<boolean> {
  const res = await apiFetch(`/api/vocab/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  return res.ok;
}

/** Persist the editable fields exposed by the vocab detail modal in one write. */
export async function updateVocabEntry(
  id: string,
  updates: Partial<Pick<VocabEntry, 'state' | 'translation' | 'sentence'>>,
): Promise<void> {
  const res = await apiFetch(`/api/vocab/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw await apiError(res, 'Could not update vocabulary entry');
}

export async function getVocabByState(state: WordState): Promise<VocabEntry[]> {
  const res = await apiFetch(`/api/vocab${langParam()}&state=${state}`);
  const vocab = await res.json();
  return vocab.map((v: Record<string, unknown>) => ({
    ...v,
    stateUpdatedAt: new Date(v.stateUpdatedAt as string),
    createdAt: new Date(v.createdAt as string),
  }));
}

export async function getVocabForBook(bookId: string): Promise<VocabEntry[]> {
  const res = await apiFetch(`/api/vocab${langParam()}&bookId=${bookId}`);
  const vocab = await res.json();
  return vocab.map((v: Record<string, unknown>) => ({
    ...v,
    stateUpdatedAt: new Date(v.stateUpdatedAt as string),
    createdAt: new Date(v.createdAt as string),
  }));
}

export async function getUnpushedVocab(): Promise<VocabEntry[]> {
  const res = await apiFetch(`/api/vocab${langParam()}&unpushed=true`);
  const vocab = await res.json();
  return vocab.map((v: Record<string, unknown>) => ({
    ...v,
    stateUpdatedAt: new Date(v.stateUpdatedAt as string),
    createdAt: new Date(v.createdAt as string),
  }));
}

export async function markVocabPushedToAnki(id: string, ankiNoteId: number): Promise<number> {
  const res = await apiFetch(`/api/vocab/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pushedToAnki: true, ankiNoteId }),
  });
  return res.ok ? 1 : 0;
}

export async function deleteVocabEntry(id: string): Promise<void> {
  await apiFetch(`/api/vocab/${id}`, { method: 'DELETE' });
}

// ============================================================================
// Helper Functions - Known Words (Fast Lookup)
// ============================================================================

export async function getWordState(word: string): Promise<WordState | undefined> {
  const map = await getKnownWordsMap();
  return map.get(foldWord(word, getActivePack()));
}

export async function updateWordState(word: string, state: WordState): Promise<boolean> {
  // Signals success (#232): apiFetch never throws (it returns a synthetic 502
  // on network failure), so callers must check res.ok or a failed save looks
  // exactly like a successful one.
  const res = await apiFetch('/api/known-words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      updates: [{ word: foldWord(word, getActivePack()), state }],
      language: getActiveLanguage(),
    }),
  });
  return res.ok;
}

export async function getKnownWordsMap(): Promise<Map<string, WordState>> {
  const res = await apiFetch(`/api/known-words${langParam()}`);
  const data = await res.json();
  return new Map(Object.entries(data) as [string, WordState][]);
}

// ============================================================================
// Plan entitlements (#222) — informational; enforcement is server-side
// ============================================================================

export interface ClientEntitlements {
  plan: 'free' | 'cloud' | 'plus' | 'unlimited';
  byok: boolean;
  limits: Record<string, number | null>;
  usage: Record<string, number>;
  periods: { day: string; month: string };
}

let entitlementsCache: {
  tenantId: string;
  value: ClientEntitlements;
  at: number;
} | null = null;

/** Provider/funding changes alter effective limits immediately. */
export function invalidateEntitlementsCache(): void {
  entitlementsCache = null;
}

/**
 * The account's plan limits + this month's usage, cached for five minutes —
 * surfaces read it to REFLECT limits (reader selection cap, journal meter);
 * the API enforces them regardless. Null when the endpoint is unavailable
 * (network hiccup) — callers must treat null as "don't reflect anything".
 */
export async function getEntitlements(): Promise<ClientEntitlements | null> {
  const tenantId = activeTenantId();
  if (
    tenantId !== null &&
    entitlementsCache?.tenantId === tenantId &&
    Date.now() - entitlementsCache.at < 5 * 60_000
  ) {
    return entitlementsCache.value;
  }
  const res = await apiFetch('/api/billing/entitlements');
  if (!res.ok) return null;
  const value = (await res.json()) as ClientEntitlements;
  // Cloud pre-session reads must never become a browser-global cache entry.
  // AuthGuard records the tenant before app surfaces mount; selfhost uses the
  // stable `local` namespace.
  if (tenantId !== null) entitlementsCache = { tenantId, value, at: Date.now() };
  return value;
}

export async function getAllKnownWords(): Promise<KnownWord[]> {
  const res = await apiFetch(`/api/known-words${langParam()}`);
  const data = await res.json();
  return Object.entries(data).map(([word, state]) => ({ word, state: state as WordState }));
}

export async function bulkUpdateWordStates(
  updates: Array<{ word: string; state: WordState }>,
): Promise<void> {
  await apiFetch('/api/known-words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates, language: getActiveLanguage() }),
  });
}

// ============================================================================
// Helper Functions - Cloze Sentences
// ============================================================================

export async function getClozeSentence(id: string): Promise<ClozeSentence | undefined> {
  const res = await apiFetch(`/api/cloze/${id}${langParam()}`);
  if (!res.ok) return undefined;
  const data = await res.json();
  return {
    ...data,
    nextReview: new Date(data.nextReview),
    lastReviewed: data.lastReviewed ? new Date(data.lastReviewed) : undefined,
  };
}

export async function saveClozeSentence(sentence: ClozeSentence): Promise<string> {
  const res = await apiFetch('/api/cloze', {
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
  const res = await apiFetch(`/api/cloze/due?limit=${limit}${langParam('&')}`);
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
  nextReview: Date,
): Promise<number> {
  const res = await apiFetch(`/api/cloze/${id}/review${langParam()}`, {
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
  const res = await apiFetch(`/api/cloze${langParam()}&limit=10000`);
  const sentences = await res.json();
  return sentences.map((s: Record<string, unknown>) => ({
    ...s,
    nextReview: new Date(s.nextReview as string),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed as string) : undefined,
  }));
}

export async function getClozeTotals(): Promise<{ timesCorrect: number; timesIncorrect: number }> {
  const res = await apiFetch(`/api/cloze/stats${langParam()}`);
  return res.json();
}

export async function getClozeSentenceByTatoebaId(
  tatoebaSentenceId: number,
): Promise<ClozeSentence | undefined> {
  const all = await getAllClozeSentences();
  return all.find((s) => s.tatoebaSentenceId === tatoebaSentenceId);
}

export async function getClozeSentencesForWord(word: string): Promise<ClozeSentence[]> {
  const res = await apiFetch(`/api/cloze${langParam()}&word=${encodeURIComponent(word)}`);
  const sentences = await res.json();
  return sentences.map((s: Record<string, unknown>) => ({
    ...s,
    nextReview: new Date(s.nextReview as string),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed as string) : undefined,
  }));
}

export async function bulkSaveClozeSentences(sentences: ClozeSentence[]): Promise<void> {
  await apiFetch('/api/cloze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      sentences.map((s) => ({
        ...s,
        nextReview: s.nextReview.toISOString(),
        lastReviewed: s.lastReviewed?.toISOString(),
        language: getActiveLanguage(),
      })),
    ),
  });
}

export async function seedSentenceBank(): Promise<{ seeded: number; total: number }> {
  const res = await apiFetch('/api/cloze/seed', { method: 'POST' });
  return res.json();
}

export async function blacklistClozeSentence(id: string): Promise<void> {
  await apiFetch(`/api/cloze/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blacklisted: 1 }),
  });
}

export async function unblacklistClozeSentence(id: string): Promise<void> {
  await apiFetch(`/api/cloze/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blacklisted: 0 }),
  });
}

export async function getClozeSentencesByCollection(
  collection: ClozeCollection,
  limit: number = 20,
  excludeWords: string[] = [],
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
  const res = await apiFetch(`/api/cloze/due?${params}`);
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
  excludeWords: string[] = [],
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
  const res = await apiFetch(`/api/cloze/due?${params}`);
  const sentences = await res.json();
  return sentences.map((s: Record<string, unknown>) => ({
    ...s,
    nextReview: new Date(s.nextReview as string),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed as string) : undefined,
  }));
}

export async function getCollectionCounts(): Promise<
  Record<ClozeCollection, { total: number; due: number; mastered: number }>
> {
  const res = await apiFetch(`/api/cloze/counts${langParam()}`);
  return res.json();
}

export async function getStreak(): Promise<{
  streak: number;
  longest: number;
  practicedToday: boolean;
}> {
  const res = await apiFetch(`/api/stats/streak${langParam()}`);
  return res.json();
}

/** One fluency-radar axis — a topic domain's strength, from the /fluency route. */
export interface DomainAxis {
  domain: string;
  label: string;
  knownCount: number;
  masteryScore: number;
  /** 0–100, log-normalised; what the radar polygon plots. */
  axisValue: number;
  /** Novice | Developing | Strong | Expert. */
  band: string;
}

export interface FluencyStats {
  totalKnownWords: number;
  totalLearning: number;
  totalNew: number;
  byState: Record<WordState, number>;
  estimatedLevel: {
    code: string;
    label: string;
    min: number;
    max: number | null;
  };
  nextLevel: { code: string; label: string } | null;
  progressToNextLevel: number;
  wordsToNextLevel: number | null;
  weeklyGrowth: {
    thisWeek: number;
    lastWeek: number;
    delta: number;
  };
  /** Per-domain strengths for the fluency radar (one entry per fixed taxonomy axis). */
  byDomain: DomainAxis[];
  /** Mastery-state words the background classifier hasn't tagged yet (drains to 0). */
  pending: number;
}

export async function getFluencyStats(
  language: string = getActiveLanguage(),
): Promise<FluencyStats> {
  const params = new URLSearchParams({ language });
  const res = await apiFetch(`/api/stats/fluency?${params}`);
  return res.json();
}

export async function getReadingStats(): Promise<import('./stats-derive').ReadingStats> {
  const res = await apiFetch(`/api/stats/reading${langParam()}`);
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

export async function getJournalEntries(
  limit: number = 20,
  offset: number = 0,
): Promise<JournalEntry[]> {
  const res = await apiFetch(`/api/journal?limit=${limit}&offset=${offset}${langParam('&')}`);
  return res.json();
}

export async function getJournalEntriesByDate(date: string): Promise<JournalEntry[]> {
  const res = await apiFetch(`/api/journal?date=${date}${langParam('&')}`);
  return res.json();
}

export async function getJournalEntry(id: string): Promise<JournalEntry | undefined> {
  const res = await apiFetch(`/api/journal/${id}`);
  if (!res.ok) return undefined;
  return res.json();
}

export function createJournalEntry(body: string): Promise<Response> {
  const entryDate = new Date().toISOString().split('T')[0];

  return apiFetch('/api/journal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, entryDate, language: getActiveLanguage() }),
  });
}

export function updateJournalDraft(id: string, body: string): Promise<Response> {
  return apiFetch(`/api/journal/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

export async function submitJournalForCorrection(
  id: string,
): Promise<{ correctedBody: string; corrections: Correction[] }> {
  const res = await apiFetch(`/api/journal/${id}/correct`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Correction failed');
  }
  return res.json();
}

export async function deleteJournalEntry(id: string): Promise<void> {
  await apiFetch(`/api/journal/${id}`, { method: 'DELETE' });
}

// ============================================================================
// Helper Functions - Daily Stats
// ============================================================================

export async function getDailyStats(date: string): Promise<DailyStats | undefined> {
  const res = await apiFetch(`/api/stats?startDate=${date}&endDate=${date}${langParam('&')}`);
  const stats = await res.json();
  return stats[0];
}

export async function getTodayStats(): Promise<DailyStats> {
  const res = await apiFetch(`/api/stats/today${langParam()}`);
  return res.json();
}

export async function incrementDailyStat(
  field: keyof Omit<DailyStats, 'date'>,
  amount: number = 1,
): Promise<boolean> {
  const res = await apiFetch(`/api/stats/today${langParam()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, amount }),
  });
  return res.ok;
}

export async function getStatsForDateRange(
  startDate: string,
  endDate: string,
): Promise<DailyStats[]> {
  const res = await apiFetch(
    `/api/stats?startDate=${startDate}&endDate=${endDate}${langParam('&')}`,
  );
  return res.json();
}

// All daily-stats rows, oldest first — used by the stats page so the "All" range
// and full-history cumulative series have everything to work with.
export async function getAllDailyStats(): Promise<DailyStats[]> {
  const res = await apiFetch(`/api/stats${langParam()}`);
  return res.json();
}

// App-wide activity per date (no language param on purpose, #238) — feeds the
// heatmap so it agrees with the equally app-wide streak.
export async function getAppWideActivity(): Promise<
  Pick<
    DailyStats,
    'date' | 'dictionaryLookups' | 'clozePracticed' | 'minutesRead' | 'ankiReviews'
  >[]
> {
  const res = await apiFetch('/api/stats/activity');
  return res.json();
}

export async function getRecentStats(days: number = 7): Promise<DailyStats[]> {
  const res = await apiFetch(`/api/stats?days=${days}${langParam('&')}`);
  return res.json();
}

// Best-effort sync of Anki's per-day review counts into dailyStats.ankiReviews,
// so the activity heatmap + streak reflect Anki study. Returns connected:false
// (a no-op) when AnkiConnect is unreachable. Safe to call on every stats load —
// a closed Anki refuses the connection instantly.
export async function syncAnkiReviews(): Promise<{
  connected: boolean;
  synced: number;
  reviewsToday?: number;
}> {
  const res = await apiFetch('/api/anki/sync-reviews', { method: 'POST' });
  return res.json();
}

// ============================================================================
// Helper Functions - Settings
// ============================================================================

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const res = await apiFetch(`/api/settings/${key}`);
  if (!res.ok) return undefined;
  return res.json();
}

export async function setSetting<T>(key: string, value: T): Promise<string> {
  await apiFetch(`/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  return key;
}

export async function deleteSetting(key: string): Promise<void> {
  await apiFetch(`/api/settings/${key}`, { method: 'DELETE' });
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const res = await apiFetch('/api/settings');
  return res.json();
}

// ============================================================================
// Helper Functions - Starter Content (#315)
// ============================================================================

export async function getStarterStatus(
  language: string,
): Promise<StarterContentResult & { available: boolean }> {
  const res = await apiFetch(`/api/starter/status?language=${language}`);
  if (!res.ok) return { available: false, seeded: false };
  return res.json();
}

export interface StarterContentResult {
  seeded: boolean;
  reason?: string;
  collectionId?: string;
  lessonCount?: number;
  recommendedLessonId?: string;
  recommendedLessonTitle?: string;
}

/**
 * Copy the language pack's starter collection into the user's library.
 * Idempotent server-side (once per user+language); resolves { seeded: false }
 * rather than throwing when there's nothing to seed or the API errored —
 * language selection must never break on a missing starter pack.
 */
export async function seedStarterContent(language: string): Promise<StarterContentResult> {
  try {
    const res = await apiFetch('/api/starter/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language }),
    });
    if (!res.ok) return { seeded: false };
    return await res.json();
  } catch {
    return { seeded: false };
  }
}

// ============================================================================
// Helper Functions - Guided onboarding practice (#331)
// ============================================================================

/**
 * Materialise one idempotent mined cloze card from a word the learner saved in
 * the reader. The API verifies ownership and finds the word's token position;
 * callers never invent a card for another user's vocab row.
 */
export async function createOnboardingCloze(input: {
  vocabId: string;
  word: string;
  sentence: string;
  translation: string;
}): Promise<ClozeSentence | null> {
  const res = await apiFetch('/api/cloze/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, language: getActiveLanguage() }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    ...data,
    nextReview: new Date(data.nextReview),
    lastReviewed: data.lastReviewed ? new Date(data.lastReviewed) : undefined,
  };
}

/** Fetch exactly the reader-mined cards named by the onboarding snapshot. */
export async function getOnboardingCloze(vocabIds: string[]): Promise<ClozeSentence[]> {
  if (vocabIds.length === 0) return [];
  const params = new URLSearchParams({
    vocabIds: [...new Set(vocabIds)].slice(0, 20).join(','),
    language: getActiveLanguage(),
  });
  const res = await apiFetch(`/api/cloze/onboarding?${params}`);
  if (!res.ok) return [];
  const sentences = await res.json();
  return sentences.map((sentence: Record<string, unknown>) => ({
    ...sentence,
    nextReview: new Date(sentence.nextReview as string),
    lastReviewed: sentence.lastReviewed ? new Date(sentence.lastReviewed as string) : undefined,
  }));
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
  const res = await apiFetch('/api/tokens');
  return res.json();
}

export async function createApiToken(data: {
  name: string;
  scopes: string[];
  expiresAt?: string;
}): Promise<ApiTokenCreateResponse> {
  const res = await apiFetch('/api/tokens', {
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
  await apiFetch(`/api/tokens/${id}`, { method: 'DELETE' });
}

// ============================================================================
// Utility Functions
// ============================================================================

export async function exportAllData(): Promise<{
  collections: Collection[];
  vocab: VocabEntry[];
  knownWords: KnownWord[];
  clozeSentences: ClozeSentence[];
  dailyStats: DailyStats[];
  settings: unknown[];
}> {
  const res = await apiFetch('/api/data');
  return res.json();
}

// ============================================================================
// Import from Dexie backup
// ============================================================================

export async function importFromDexie(data: Record<string, unknown[]>): Promise<{
  success: boolean;
  imported: Record<string, number>;
}> {
  const res = await apiFetch('/api/data', {
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
  const params = new URLSearchParams({ limit: limit.toString(), language: getActiveLanguage() });
  if (before) params.set('before', before);
  const res = await apiFetch(`/api/chat?${params}`);
  return res.json();
}

export async function sendChatMessage(message: string): Promise<{
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}> {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, language: getActiveLanguage() }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to send message');
  }
  return res.json();
}

export async function clearChatMessages(): Promise<void> {
  await apiFetch(`/api/chat${langParam()}`, { method: 'DELETE' });
}
