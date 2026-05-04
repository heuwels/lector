import { NextRequest, NextResponse } from 'next/server';
import { db, JournalEntryRow } from '@/lib/server/database';

const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:3457';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntryRow | undefined;

  if (!entry) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }

  if (!entry.body.trim()) {
    return NextResponse.json({ error: 'Entry body is empty' }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_URL}/api/journal-correct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: entry.body, language: (entry as JournalEntryRow & { language?: string }).language || 'af' }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE journal_entries
      SET correctedBody = ?, corrections = ?, status = 'submitted', updatedAt = ?
      WHERE id = ?
    `).run(data.correctedBody, JSON.stringify(data.corrections), now, id);

    return NextResponse.json({
      correctedBody: data.correctedBody,
      corrections: data.corrections,
    });
  } catch (error) {
    console.error('Journal correction error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Correction failed' },
      { status: 500 }
    );
  }
}
