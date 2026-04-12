import { NextRequest, NextResponse } from 'next/server';
import { db, LessonRow } from '@/lib/server/database';

// GET /api/lessons/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as LessonRow | undefined;

  if (!lesson) {
    return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  }

  return NextResponse.json(lesson);
}

// PUT /api/lessons/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title); }
  if (body.textContent !== undefined) { updates.push('textContent = ?'); values.push(body.textContent); }
  if (body.sortOrder !== undefined) { updates.push('sortOrder = ?'); values.push(body.sortOrder); }
  if (body.collectionId !== undefined) { updates.push('collectionId = ?'); values.push(body.collectionId); }

  updates.push('lastReadAt = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE lessons SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return NextResponse.json({ success: true });
}

// DELETE /api/lessons/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  db.prepare('DELETE FROM lessons WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
