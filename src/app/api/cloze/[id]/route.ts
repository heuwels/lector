import { NextRequest, NextResponse } from 'next/server';
import { db, ClozeSentenceRow } from '@/lib/server/database';

// GET /api/cloze/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sentence = db.prepare('SELECT * FROM clozeSentences WHERE id = ?').get(id) as ClozeSentenceRow | undefined;

  if (!sentence) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    ...sentence,
    nextReview: new Date(sentence.nextReview),
    lastReviewed: sentence.lastReviewed ? new Date(sentence.lastReviewed) : null,
  });
}

// PUT /api/cloze/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const existing = db.prepare('SELECT id FROM clozeSentences WHERE id = ?').get(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  const fields = ['sentence', 'clozeWord', 'clozeIndex', 'translation', 'source', 'collection', 'wordRank', 'masteryLevel', 'nextReview', 'reviewCount', 'lastReviewed', 'timesCorrect', 'timesIncorrect', 'blacklisted'];

  for (const field of fields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(body[field] instanceof Date ? body[field].toISOString() : body[field]);
    }
  }

  if (updates.length > 0) {
    values.push(id);
    db.prepare(`UPDATE clozeSentences SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/cloze/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  db.prepare('DELETE FROM clozeSentences WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
