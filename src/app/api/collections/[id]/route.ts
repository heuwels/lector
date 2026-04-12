import { NextRequest, NextResponse } from 'next/server';
import { db, CollectionRow } from '@/lib/server/database';

// GET /api/collections/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const collection = db.prepare(`
    SELECT c.*, COUNT(l.id) as lessonCount,
      COALESCE(AVG(l.progress_percentComplete), 0) as avgProgress
    FROM collections c
    LEFT JOIN lessons l ON l.collectionId = c.id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(id) as (CollectionRow & { lessonCount: number; avgProgress: number }) | undefined;

  if (!collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
  }

  return NextResponse.json(collection);
}

// PUT /api/collections/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title); }
  if (body.author !== undefined) { updates.push('author = ?'); values.push(body.author); }
  if (body.coverUrl !== undefined) { updates.push('coverUrl = ?'); values.push(body.coverUrl); }

  updates.push('lastReadAt = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE collections SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return NextResponse.json({ success: true });
}

// DELETE /api/collections/[id] - cascades to lessons
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  db.prepare('DELETE FROM lessons WHERE collectionId = ?').run(id);
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
