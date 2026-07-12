import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { db } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { parseEpub, type ParsedEpub } from '../lib/epub-parser';
import { entitlements, planLimitResponse, type EntitlementsEngine } from '../lib/entitlements';
import { collectionMetadataBytes, lessonTextBytes } from '../lib/storage-limits';
import { randomUUID } from 'crypto';

// Cap the upload before it's buffered into memory. EPUBs are small; this stops a
// large/zip-bomb upload from exhausting memory (the multipart body is buffered
// in full here).
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

interface ImportRouteDeps {
  engine: EntitlementsEngine;
  parse: (buffer: Buffer) => ParsedEpub;
}

export function makeImportRoutes({ engine, parse }: ImportRouteDeps): Hono {
  const app = new Hono();

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
        const userId = getCurrentUserId(c);

        // One collection is the only guaranteed cost we know before touching
        // the multipart body. Reject a full library before formData() buffers
        // the upload; the authoritative atomic reservation below still
        // re-checks it and adds the parsed chapter count.
        const preflight = engine.checkLimit(userId, 'maxCollections');
        if (!preflight.allowed) return planLimitResponse(c, preflight);

        const formData = await c.req.formData();
        const file = formData.get('file');
        const lang = resolveLanguage(formData.get('language') as string | null, userId);

        if (!file || typeof file === 'string') {
          return c.json({ error: 'File required' }, 400);
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const parsed = parse(buffer);

        const collectionId = randomUUID();
        const now = new Date().toISOString();

        const insertCollection = db.prepare(`
          INSERT INTO collections (id, title, author, coverUrl, language, createdAt, lastReadAt, userId)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertLesson = db.prepare(`
          INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, wordCount, language, createdAt, lastReadAt, userId)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // Library size (#222): an EPUB adds one collection + all its chapters at
        // once — check the whole batch AND insert in one transaction so nothing
        // lands if the cap is hit, and the count can't race a concurrent import
        // (#222 review). This final reservation is authoritative; the preflight
        // above deliberately provides no security guarantee.
        const chapterBytes = parsed.chapters.map((chapter) =>
          lessonTextBytes(chapter.markdown, chapter.title),
        );
        const verdict = engine.reserveCount(
          userId,
          [
            { metric: 'maxCollections' },
            { metric: 'maxLessons', requested: parsed.chapters.length },
            {
              metric: 'maxLessonTextBytes',
              requested: Math.max(0, ...chapterBytes),
            },
            {
              metric: 'maxLessonTextBytesTotal',
              requested: chapterBytes.reduce((total, size) => total + size, 0),
            },
            {
              metric: 'maxCollectionMetadataBytes',
              requested: collectionMetadataBytes(parsed),
            },
          ],
          () => {
            insertCollection.run(
              collectionId,
              parsed.title,
              parsed.author,
              null,
              lang,
              now,
              now,
              userId,
            );

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
                userId,
              );
            }
          },
        );
        if (!verdict.allowed) return planLimitResponse(c, verdict);

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

  return app;
}

export default makeImportRoutes({ engine: entitlements, parse: parseEpub });
