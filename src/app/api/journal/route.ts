import { NextRequest, NextResponse } from 'next/server';
import { db, JournalEntryRow } from '@/lib/server/database';
import { resolveLanguage } from '@/lib/server/active-language';
import { randomUUID } from 'crypto';

// GET /api/journal - List entries, optionally filtered by date
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lang = resolveLanguage(searchParams.get('language'));
  const date = searchParams.get('date');
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  if (date) {
    // Return all entries for a given date
    const entries = db.prepare(
      'SELECT * FROM journal_entries WHERE entryDate = ? AND language = ? ORDER BY createdAt DESC'
    ).all(date, lang) as JournalEntryRow[];
    return NextResponse.json(entries.map(e => ({
      ...e,
      corrections: e.corrections ? JSON.parse(e.corrections) : null,
    })));
  }

  const entries = db.prepare(
    'SELECT * FROM journal_entries WHERE language = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?'
  ).all(lang, limit, offset) as JournalEntryRow[];

  return NextResponse.json(entries.map(e => ({
    ...e,
    corrections: e.corrections ? JSON.parse(e.corrections) : null,
  })));
}

// POST /api/journal - Create a new journal entry
export async function POST(request: NextRequest) {
  const { body, entryDate, language } = await request.json();
  const lang = resolveLanguage(language);
  const date = entryDate || new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  const wordCount = (body || '').trim().split(/\s+/).filter(Boolean).length;

  const id = randomUUID();
  db.prepare(`
    INSERT INTO journal_entries (id, body, status, wordCount, entryDate, language, createdAt, updatedAt)
    VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)
  `).run(id, body || '', wordCount, date, lang, now, now);

  return NextResponse.json({ id, entryDate: date });
}
