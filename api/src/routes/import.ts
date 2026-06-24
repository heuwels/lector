import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { db } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { parseEpub } from '../lib/epub-parser';
import { randomUUID } from 'crypto';

const app = new Hono();

// Cap the upload before it's buffered into memory. EPUBs are small; this stops a
// large/zip-bomb upload from exhausting memory (the multipart body is buffered
// in full both here and in the Next proxy).
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

// POST /api/import/epub - import an EPUB as a collection of lessons
app.post(
  '/epub',
  bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: (c) => c.json({ error: 'EPUB is too large (max 50 MB).' }, 413),
  }),
  async (c) => {
    // formData() parsing is inside the try so a malformed multipart body returns
    // this route's 400 rather than escaping to the global 500 handler.
    try {
      const formData = await c.req.formData();
      const file = formData.get('file');
      const lang = resolveLanguage(formData.get('language') as string | null);

      if (!file || typeof file === 'string') {
        return c.json({ error: 'File required' }, 400);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = parseEpub(buffer);
      const collectionId = randomUUID();
      const now = new Date().toISOString();

      const insertCollection = db.prepare(`
        INSERT INTO collections (id, title, author, coverUrl, language, createdAt, lastReadAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertLesson = db.prepare(`
        INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, wordCount, language, createdAt, lastReadAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      db.transaction(() => {
        insertCollection.run(collectionId, parsed.title, parsed.author, null, lang, now, now);

        for (let i = 0; i < parsed.chapters.length; i++) {
          const chapter = parsed.chapters[i];
          insertLesson.run(
            randomUUID(),
            collectionId,
            chapter.title,
            i,
            chapter.markdown,
            chapter.wordCount,
            lang,
            now,
            now,
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
  },
);

export default app;
