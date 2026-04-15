import { NextRequest, NextResponse } from 'next/server';
import { db, JournalEntryRow } from '@/lib/server/database';

// GET /api/journal/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntryRow | undefined;

  if (!entry) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }

  return NextResponse.json({
    ...entry,
    corrections: entry.corrections ? JSON.parse(entry.corrections) : null,
  });
}

// PUT /api/journal/[id] - Update draft body
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const existing = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntryRow | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }

  if (existing.status === 'submitted' && body.body !== undefined) {
    return NextResponse.json({ error: 'Cannot edit a submitted entry' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const updates: string[] = ['updatedAt = ?'];
  const values: unknown[] = [now];

  if (body.body !== undefined) {
    updates.push('body = ?', 'wordCount = ?');
    const wordCount = body.body.trim().split(/\s+/).filter(Boolean).length;
    values.push(body.body, wordCount);
  }

  values.push(id);
  db.prepare(`UPDATE journal_entries SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return NextResponse.json({ success: true });
}

// DELETE /api/journal/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const entry = db.prepare('SELECT id FROM journal_entries WHERE id = ?').get(id);

  if (!entry) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }

  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
