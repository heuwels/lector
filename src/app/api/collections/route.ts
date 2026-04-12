import { NextRequest, NextResponse } from 'next/server';
import { db, CollectionRow, LessonRow } from '@/lib/server/database';
import { randomUUID } from 'crypto';

// GET /api/collections - List all collections with lesson counts
export async function GET() {
  const collections = db.prepare(`
    SELECT c.*, COUNT(l.id) as lessonCount,
      COALESCE(AVG(l.progress_percentComplete), 0) as avgProgress
    FROM collections c
    LEFT JOIN lessons l ON l.collectionId = c.id
    GROUP BY c.id
    ORDER BY c.lastReadAt DESC
  `).all() as (CollectionRow & { lessonCount: number; avgProgress: number })[];

  return NextResponse.json(collections);
}

// POST /api/collections - Create a new collection
export async function POST(request: NextRequest) {
  const body = await request.json();
  const id = body.id || randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO collections (id, title, author, coverUrl, createdAt, lastReadAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, body.title, body.author || 'Unknown', body.coverUrl || null, now, now);

  return NextResponse.json({ id });
}
