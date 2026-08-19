import { createHash } from 'crypto';
import type { Context } from 'hono';
import { db } from '../db';
import { lessonTextBytes } from './storage-limits';

export const BURIED_SCORE = -5;
export const MAX_PENDING_SUBMISSIONS = 3;
export const MAX_SUBMIT_LESSONS = 1_000;
export const MAX_SUBMIT_LESSON_BYTES = 1024 * 1024;
export const MAX_DESCRIPTION_BYTES = 2_000;

export type CommunityStatus = 'pending' | 'published' | 'rejected';

export interface CommunityItemRow {
  id: string;
  language: string;
  title: string;
  author: string;
  description: string | null;
  coverUrl: string | null;
  submitterUserId: string;
  sourceCollectionId: string;
  contentHash: string;
  lessonCount: number;
  wordCount: number;
  status: CommunityStatus;
  attestationAt: string;
  rejectReason: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  upVoteCount: number;
  downVoteCount: number;
  score: number;
  createdAt: string;
  publishedAt: string | null;
}

export interface CommunityLessonRow {
  itemId: string;
  sortOrder: number;
  title: string;
  textContent: string;
  wordCount: number;
  sourceType: string | null;
  sourceMeta: string | null;
  segments: string | null;
}

export function communityContentHash(input: {
  language: string;
  title: string;
  author: string;
  bodies: string[];
}): string {
  return createHash('sha256')
    .update([input.language, input.title, input.author, ...input.bodies].join('\0'))
    .digest('hex');
}

export function submissionTooLarge(
  lessons: Array<{ title: string; textContent: string }>,
): boolean {
  if (lessons.length > MAX_SUBMIT_LESSONS) return true;
  return lessons.some(
    (lesson) => lessonTextBytes(lesson.textContent, lesson.title) > MAX_SUBMIT_LESSON_BYTES,
  );
}

export function loadCommunityItem(id: string): CommunityItemRow | undefined {
  return db.prepare('SELECT * FROM community_items WHERE id = ?').get(id) as
    | CommunityItemRow
    | undefined;
}

export function loadCommunityLessons(itemId: string): CommunityLessonRow[] {
  return db
    .prepare('SELECT * FROM community_lessons WHERE itemId = ? ORDER BY sortOrder')
    .all(itemId) as CommunityLessonRow[];
}

export function catalogVisible(item: CommunityItemRow): boolean {
  return item.status === 'published' && item.score > BURIED_SCORE;
}

export function recalcCommunityScore(itemId: string): { up: number; down: number; score: number } {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) AS up,
         COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) AS down
       FROM community_votes WHERE itemId = ?`,
    )
    .get(itemId) as { up: number; down: number };
  const score = row.up - row.down;
  db.prepare(
    'UPDATE community_items SET upVoteCount = ?, downVoteCount = ?, score = ? WHERE id = ?',
  ).run(row.up, row.down, score, itemId);
  return { up: row.up, down: row.down, score };
}

/** Cloud-mode gate. Self-host has no accounts, so the catalog does not exist. */
export function cloudCommunityUserId(
  c: Context,
  authRequired: boolean,
): { userId: string } | { response: Response } {
  if (!authRequired) {
    return { response: c.json({ error: 'Not found' }, 404) };
  }
  const userId = c.get('userId');
  if (typeof userId !== 'string' || userId.length === 0) {
    return { response: c.json({ error: 'Authentication required' }, 401) };
  }
  return { userId };
}
