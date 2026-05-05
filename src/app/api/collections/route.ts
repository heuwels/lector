import { NextRequest, NextResponse } from 'next/server';
import { db, CollectionRow } from '@/lib/server/database';
import { resolveLanguage } from '@/lib/server/active-language';
import { randomUUID } from 'crypto';

// GET /api/collections - List all collections with lesson counts
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lang = resolveLanguage(searchParams.get('language'));

  const collections = db.prepare(`
    SELECT c.*, g.name as groupName, COUNT(l.id) as lessonCount,
      COALESCE(AVG(l.progress_percentComplete), 0) as avgProgress
    FROM collections c
    LEFT JOIN collection_groups g ON g.id = c.groupId
    LEFT JOIN lessons l ON l.collectionId = c.id AND l.language = c.language
    WHERE c.language = ?
    GROUP BY c.id
    ORDER BY c.lastReadAt DESC
  `).all(lang) as (CollectionRow & { groupName: string | null; lessonCount: number; avgProgress: number })[];

  return NextResponse.json(collections);
}

// POST /api/collections - Create a new collection
export async function POST(request: NextRequest) {
  const body = await request.json();
  const id = body.id || randomUUID();
  const now = new Date().toISOString();
  const lang = resolveLanguage(body.language);

  db.prepare(`
    INSERT INTO collections (id, title, author, coverUrl, language, createdAt, lastReadAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, body.title, body.author || 'Unknown', body.coverUrl || null, lang, now, now);

  return NextResponse.json({ id });
}
