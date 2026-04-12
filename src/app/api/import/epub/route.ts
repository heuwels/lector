import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/server/database';
import { parseEpub } from '@/lib/server/epub-parser';
import { randomUUID } from 'crypto';

// POST /api/import/epub - Import an EPUB file as a collection of lessons
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'File required' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const parsed = parseEpub(buffer);
    const collectionId = randomUUID();
    const now = new Date().toISOString();

    const insertCollection = db.prepare(`
      INSERT INTO collections (id, title, author, coverUrl, createdAt, lastReadAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertLesson = db.prepare(`
      INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, wordCount, createdAt, lastReadAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      insertCollection.run(collectionId, parsed.title, parsed.author, null, now, now);

      for (let i = 0; i < parsed.chapters.length; i++) {
        const chapter = parsed.chapters[i];
        insertLesson.run(
          randomUUID(),
          collectionId,
          chapter.title,
          i,
          chapter.markdown,
          chapter.wordCount,
          now,
          now
        );
      }
    })();

    return NextResponse.json({
      collectionId,
      title: parsed.title,
      author: parsed.author,
      lessonCount: parsed.chapters.length,
    });
  } catch (err) {
    console.error('EPUB import failed:', err);
    return NextResponse.json(
      { error: 'Failed to parse EPUB file' },
      { status: 400 }
    );
  }
}
