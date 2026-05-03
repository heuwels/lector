import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/server/database';

// PUT /api/groups/[id] - Update a group
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    if (!body.name.trim()) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }
    updates.push('name = ?'); values.push(body.name.trim());
  }
  if (body.sortOrder !== undefined) { updates.push('sortOrder = ?'); values.push(body.sortOrder); }

  if (updates.length === 0) {
    return NextResponse.json({ success: true });
  }

  values.push(id);
  db.prepare(`UPDATE collection_groups SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return NextResponse.json({ success: true });
}

// DELETE /api/groups/[id] - Delete a group (collections become ungrouped)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Manually ungroup collections since SQLite FK ON DELETE SET NULL requires PRAGMA foreign_keys = ON
  db.prepare('UPDATE collections SET groupId = NULL WHERE groupId = ?').run(id);
  db.prepare('DELETE FROM collection_groups WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
