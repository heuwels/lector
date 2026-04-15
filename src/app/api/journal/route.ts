import { NextRequest, NextResponse } from 'next/server';
import { db, JournalEntryRow } from '@/lib/server/database';
import { randomUUID } from 'crypto';

// GET /api/journal - List entries or get by date
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  if (date) {
    const entry = db.prepare('SELECT * FROM journal_entries WHERE entryDate = ?').get(date) as JournalEntryRow | undefined;
    if (!entry) {
      return NextResponse.json(null);
    }
    return NextResponse.json({
      ...entry,
      corrections: entry.corrections ? JSON.parse(entry.corrections) : null,
    });
  }

  const entries = db.prepare(
    'SELECT * FROM journal_entries ORDER BY entryDate DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as JournalEntryRow[];

  return NextResponse.json(entries.map(e => ({
    ...e,
    corrections: e.corrections ? JSON.parse(e.corrections) : null,
  })));
}

// POST /api/journal - Create or update a draft entry
export async function POST(request: NextRequest) {
  const { body, entryDate } = await request.json();
  const date = entryDate || new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  const wordCount = (body || '').trim().split(/\s+/).filter(Boolean).length;

  // Check if entry exists for this date
  const existing = db.prepare('SELECT * FROM journal_entries WHERE entryDate = ?').get(date) as JournalEntryRow | undefined;

  if (existing) {
    if (existing.status === 'submitted') {
      return NextResponse.json({ error: 'Entry already submitted for this date' }, { status: 400 });
    }
    db.prepare(
      'UPDATE journal_entries SET body = ?, wordCount = ?, updatedAt = ? WHERE id = ?'
    ).run(body, wordCount, now, existing.id);
    return NextResponse.json({ id: existing.id, entryDate: date });
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO journal_entries (id, body, status, wordCount, entryDate, createdAt, updatedAt)
    VALUES (?, ?, 'draft', ?, ?, ?, ?)
  `).run(id, body || '', wordCount, date, now, now);

  return NextResponse.json({ id, entryDate: date });
}
