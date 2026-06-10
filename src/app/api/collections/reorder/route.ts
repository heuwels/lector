import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/server/database';

// PUT /api/collections/reorder - persist a new collection order.
// Body: { ids: string[] } — the collections (typically one group's worth) in
// their new order. sortOrder is set to the array index for each id.
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const ids = body.ids;

  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'ids must be an array of strings' }, { status: 400 });
  }

  const update = db.prepare('UPDATE collections SET sortOrder = ? WHERE id = ?');
  const reorder = db.transaction((orderedIds: string[]) => {
    orderedIds.forEach((id, index) => update.run(index, id));
  });
  reorder(ids);

  return NextResponse.json({ success: true });
}
