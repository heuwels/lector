import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/server/database';

// PUT /api/collections/[id]/lessons/reorder - persist a new lesson order.
// Body: { ids: string[] } — the collection's lessons in their new order.
// sortOrder is set to the array index for each id; the update is scoped to the
// collection so a stray id can't reorder another collection's lessons.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: collectionId } = await params;
  const body = await request.json();
  const ids = body.ids;

  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'ids must be an array of strings' }, { status: 400 });
  }

  const update = db.prepare('UPDATE lessons SET sortOrder = ? WHERE id = ? AND collectionId = ?');
  const reorder = db.transaction((orderedIds: string[]) => {
    orderedIds.forEach((lessonId, index) => update.run(index, lessonId, collectionId));
  });
  reorder(ids);

  return NextResponse.json({ success: true });
}
