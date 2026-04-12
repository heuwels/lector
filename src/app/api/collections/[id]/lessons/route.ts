import { NextRequest, NextResponse } from 'next/server';
import { db, LessonRow } from '@/lib/server/database';
import { randomUUID } from 'crypto';
import { countWords } from '@/lib/html-to-markdown';

// GET /api/collections/[id]/lessons - List lessons in a collection
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lessons = db.prepare(`
    SELECT id, collectionId, title, sortOrder, progress_scrollPosition,
      progress_percentComplete, wordCount, createdAt, lastReadAt
    FROM lessons
    WHERE collectionId = ?
    ORDER BY sortOrder ASC
  `).all(id) as Omit<LessonRow, 'textContent'>[];

  return NextResponse.json(lessons);
}

// POST /api/collections/[id]/lessons - Add a lesson to a collection
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: collectionId } = await params;
  const body = await request.json();
  const id = body.id || randomUUID();
  const now = new Date().toISOString();

  // Get next sort order
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sortOrder), -1) as maxOrder FROM lessons WHERE collectionId = ?'
  ).get(collectionId) as { maxOrder: number };

  const textContent = body.textContent || '';

  db.prepare(`
    INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, wordCount, createdAt, lastReadAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, collectionId, body.title, maxOrder.maxOrder + 1, textContent, countWords(textContent), now, now);

  // Update collection lastReadAt
  db.prepare('UPDATE collections SET lastReadAt = ? WHERE id = ?').run(now, collectionId);

  return NextResponse.json({ id });
}
