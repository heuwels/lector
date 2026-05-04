import { NextRequest, NextResponse } from 'next/server';
import { db, CollectionGroupRow } from '@/lib/server/database';
import { randomUUID } from 'crypto';

// GET /api/groups - List all groups
export async function GET() {
  const groups = db.prepare(
    'SELECT * FROM collection_groups ORDER BY sortOrder ASC'
  ).all() as CollectionGroupRow[];

  return NextResponse.json(groups);
}

// POST /api/groups - Create a new group
export async function POST(request: NextRequest) {
  const { name } = await request.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sortOrder), -1) as maxOrder FROM collection_groups'
  ).get() as { maxOrder: number };

  db.prepare(
    'INSERT INTO collection_groups (id, name, sortOrder, createdAt) VALUES (?, ?, ?, ?)'
  ).run(id, name.trim(), maxOrder.maxOrder + 1, now);

  return NextResponse.json({ id });
}
