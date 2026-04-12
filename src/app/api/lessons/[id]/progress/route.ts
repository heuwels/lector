import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/server/database';

// PUT /api/lessons/[id]/progress
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id, collectionId FROM lessons WHERE id = ?').get(id) as { id: string; collectionId: string | null } | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  }

  db.prepare(`
    UPDATE lessons SET
      progress_scrollPosition = ?,
      progress_percentComplete = ?,
      lastReadAt = ?
    WHERE id = ?
  `).run(
    body.scrollPosition ?? 0,
    body.percentComplete ?? 0,
    now,
    id
  );

  // Also update the collection's lastReadAt
  if (existing.collectionId) {
    db.prepare('UPDATE collections SET lastReadAt = ? WHERE id = ?').run(now, existing.collectionId);
  }

  return NextResponse.json({ success: true });
}
