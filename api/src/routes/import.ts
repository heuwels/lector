import { Hono } from 'hono';
import { db } from '../db';
import { parseEpub } from '../lib/epub-parser';
import { randomUUID } from 'crypto';

const app = new Hono();

// POST /api/import/epub
app.post('/epub', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return c.json({ error: 'File required' }, 400);
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
          randomUUID(), collectionId, chapter.title, i,
          chapter.markdown, chapter.wordCount, now, now
        );
      }
    })();

    return c.json({
      collectionId,
      title: parsed.title,
      author: parsed.author,
      lessonCount: parsed.chapters.length,
    });
  } catch (err) {
    console.error('EPUB import failed:', err);
    return c.json({ error: 'Failed to parse EPUB file' }, 400);
  }
});

export default app;
