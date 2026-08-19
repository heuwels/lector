import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { config } from '../lib/config';
import { isAdmin, adminConfig } from '../lib/admin';
import { isValidLanguageCode } from '../lib/languages';
import { entitlements, planLimitResponse } from '../lib/entitlements';
import {
  collectionMetadataBytes,
  growingRowCheck,
  lessonTextBytes,
  utf8Bytes,
} from '../lib/storage-limits';
import { validateOwnedReference } from '../lib/persisted-input';
import {
  catalogVisible,
  communityContentHash,
  loadCommunityItem,
  loadCommunityLessons,
  MAX_DESCRIPTION_BYTES,
  MAX_PENDING_SUBMISSIONS,
  cloudCommunityUserId,
  recalcCommunityScore,
  submissionTooLarge,
  type CommunityItemRow,
} from '../lib/community';

export interface CommunityRouteOptions {
  authRequired: boolean;
  isAdminUser: (userId: string) => boolean;
  submitterLabel: (userId: string) => string;
}

interface SourceLesson {
  title: string;
  textContent: string;
  wordCount: number;
  sortOrder: number;
  sourceType: string | null;
  sourceMeta: string | null;
  segments: string | null;
  audioPath: string | null;
}

function defaultSubmitterLabel(userId: string): string {
  try {
    const row = db.prepare('SELECT name FROM user WHERE id = ?').get(userId) as
      | { name: string | null }
      | undefined;
    const name = row?.name?.trim();
    if (name) return name;
  } catch {
    // Self-host and unit tests have no Better Auth user table.
  }
  return 'A learner';
}

function viewerVote(userId: string, itemId: string): 1 | -1 | null {
  const row = db
    .prepare('SELECT value FROM community_votes WHERE userId = ? AND itemId = ?')
    .get(userId, itemId) as { value: number } | undefined;
  if (row?.value === 1 || row?.value === -1) return row.value;
  return null;
}

function hasClone(userId: string, itemId: string, language: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM collections
       WHERE userId = ? AND sourceCommunityItemId = ? AND language = ?`,
    )
    .get(userId, itemId, language);
}

function cloneId(userId: string, itemId: string, language: string): string | undefined {
  const row = db
    .prepare(
      `SELECT id FROM collections
       WHERE userId = ? AND sourceCommunityItemId = ? AND language = ?`,
    )
    .get(userId, itemId, language) as { id: string } | undefined;
  return row?.id;
}

function listPayload(
  item: CommunityItemRow,
  userId: string,
  label: string,
): Record<string, unknown> {
  return {
    id: item.id,
    language: item.language,
    title: item.title,
    author: item.author,
    description: item.description,
    coverUrl: item.coverUrl,
    lessonCount: item.lessonCount,
    wordCount: item.wordCount,
    score: item.score,
    publishedAt: item.publishedAt,
    status: item.status,
    rejectReason: item.rejectReason,
    submitterLabel: label,
    viewerVote: viewerVote(userId, item.id),
    cloned: hasClone(userId, item.id, item.language),
  };
}

export function makeCommunityRoutes(opts: CommunityRouteOptions) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const gate = cloudCommunityUserId(c, opts.authRequired);
    if ('response' in gate) return gate.response;
    return next();
  });

  function caller(c: Parameters<typeof cloudCommunityUserId>[0]): string {
    return c.get('userId') as string;
  }

  // POST /api/community/items
  app.post('/items', async (c) => {
    const userId = caller(c);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON' }, 400);
    if (body.attested !== true) return c.json({ error: 'attestation_required' }, 400);
    const collectionId = body.collectionId;
    if (typeof collectionId !== 'string' || !collectionId) {
      return c.json({ error: 'not_found' }, 400);
    }
    if (collectionId.startsWith('starter-')) {
      return c.json({ error: 'starter_not_allowed' }, 400);
    }
    let description: string | null = null;
    if (body.description !== undefined && body.description !== null) {
      if (typeof body.description !== 'string') {
        return c.json({ error: 'description must be a string' }, 400);
      }
      const trimmed = body.description.trim();
      if (utf8Bytes(trimmed) > MAX_DESCRIPTION_BYTES) {
        return c.json({ error: 'too_large' }, 400);
      }
      description = trimmed || null;
    }

    const collection = db
      .prepare(
        `SELECT id, title, author, coverUrl, language FROM collections
         WHERE userId = ? AND id = ?`,
      )
      .get(userId, collectionId) as
      | {
          id: string;
          title: string;
          author: string;
          coverUrl: string | null;
          language: string;
        }
      | undefined;
    if (!collection) return c.json({ error: 'not_found' }, 400);

    const lessons = db
      .prepare(
        `SELECT title, textContent, wordCount, sortOrder, sourceType, sourceMeta, segments, audioPath
         FROM lessons WHERE userId = ? AND collectionId = ?
         ORDER BY sortOrder, createdAt`,
      )
      .all(userId, collectionId) as SourceLesson[];

    if (lessons.some((lesson) => lesson.audioPath)) {
      return c.json({ error: 'audio_not_allowed' }, 400);
    }
    if (lessons.length === 0 || lessons.every((lesson) => !lesson.textContent.trim())) {
      return c.json({ error: 'empty_collection' }, 400);
    }
    if (submissionTooLarge(lessons)) return c.json({ error: 'too_large' }, 400);

    const pendingForSource = db
      .prepare(
        `SELECT 1 FROM community_items
         WHERE submitterUserId = ? AND sourceCollectionId = ? AND status = 'pending'`,
      )
      .get(userId, collectionId);
    if (pendingForSource) return c.json({ error: 'already_pending' }, 400);

    const pendingCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM community_items
           WHERE submitterUserId = ? AND status = 'pending'`,
        )
        .get(userId) as { n: number }
    ).n;
    if (pendingCount >= MAX_PENDING_SUBMISSIONS) {
      return c.json({ error: 'pending_limit' }, 400);
    }

    const contentHash = communityContentHash({
      language: collection.language,
      title: collection.title,
      author: collection.author,
      bodies: lessons.map((lesson) => lesson.textContent),
    });
    const duplicate = db
      .prepare(`SELECT 1 FROM community_items WHERE contentHash = ? AND status = 'published'`)
      .get(contentHash);
    if (duplicate) return c.json({ error: 'duplicate' }, 400);

    const now = new Date().toISOString();
    const itemId = randomUUID();
    const wordCount = lessons.reduce((sum, lesson) => sum + (lesson.wordCount || 0), 0);

    db.transaction(() => {
      db.prepare(
        `INSERT INTO community_items (
           id, language, title, author, description, coverUrl, submitterUserId,
           sourceCollectionId, contentHash, lessonCount, wordCount, status,
           attestationAt, createdAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(
        itemId,
        collection.language,
        collection.title,
        collection.author,
        description,
        collection.coverUrl,
        userId,
        collectionId,
        contentHash,
        lessons.length,
        wordCount,
        now,
        now,
      );
      const insertLesson = db.prepare(
        `INSERT INTO community_lessons (
           itemId, sortOrder, title, textContent, wordCount, sourceType, sourceMeta, segments
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      lessons.forEach((lesson, index) => {
        insertLesson.run(
          itemId,
          index,
          lesson.title,
          lesson.textContent,
          lesson.wordCount || 0,
          lesson.sourceType,
          lesson.sourceMeta,
          lesson.segments,
        );
      });
    })();

    return c.json({ id: itemId, status: 'pending' }, 201);
  });

  // GET /api/community/items
  app.get('/items', (c) => {
    const userId = caller(c);
    const language = c.req.query('language');
    if (!language || !isValidLanguageCode(language)) {
      return c.json({ error: 'Invalid language' }, 400);
    }
    const sort = c.req.query('sort') === 'new' ? 'new' : 'score';
    const orderSql =
      sort === 'new'
        ? 'publishedAt DESC, createdAt DESC'
        : 'score DESC, publishedAt DESC, createdAt DESC';
    const rows = db
      .prepare(
        `SELECT * FROM community_items
         WHERE language = ? AND status = 'published' AND score > ?
         ORDER BY ${orderSql}`,
      )
      .all(language, -5) as CommunityItemRow[];
    return c.json(
      rows.map((item) => listPayload(item, userId, opts.submitterLabel(item.submitterUserId))),
    );
  });

  // GET /api/community/mine — before /items/:id
  app.get('/mine', (c) => {
    const userId = caller(c);
    const rows = db
      .prepare(`SELECT * FROM community_items WHERE submitterUserId = ? ORDER BY createdAt DESC`)
      .all(userId) as CommunityItemRow[];
    return c.json(
      rows.map((item) => listPayload(item, userId, opts.submitterLabel(item.submitterUserId))),
    );
  });

  // GET /api/community/items/:id
  app.get('/items/:id', (c) => {
    const userId = caller(c);
    const item = loadCommunityItem(c.req.param('id'));
    if (!item) return c.json({ error: 'Not found' }, 404);
    const maySeeHidden = item.submitterUserId === userId || opts.isAdminUser(userId);
    if (!catalogVisible(item) && !maySeeHidden) {
      return c.json({ error: 'Not found' }, 404);
    }
    const lessons = loadCommunityLessons(item.id);
    return c.json({
      ...listPayload(item, userId, opts.submitterLabel(item.submitterUserId)),
      lessons: lessons.map((lesson) => ({
        sortOrder: lesson.sortOrder,
        title: lesson.title,
        textContent: lesson.textContent,
        wordCount: lesson.wordCount,
        sourceType: lesson.sourceType,
        sourceMeta: lesson.sourceMeta,
        segments: lesson.segments,
      })),
    });
  });

  // POST /api/community/items/:id/vote
  app.post('/items/:id/vote', async (c) => {
    const userId = caller(c);
    const item = loadCommunityItem(c.req.param('id'));
    if (!item) return c.json({ error: 'Not found' }, 404);
    if (item.submitterUserId === userId) {
      return c.json({ error: 'own_item' }, 400);
    }
    if (item.status !== 'published') return c.json({ error: 'Not found' }, 404);
    const body = await c.req.json().catch(() => null);
    const value = body?.value;
    if (value !== 1 && value !== -1 && value !== 0) {
      return c.json({ error: 'value must be 1, -1, or 0' }, 400);
    }
    const now = new Date().toISOString();
    db.transaction(() => {
      if (value === 0) {
        db.prepare('DELETE FROM community_votes WHERE userId = ? AND itemId = ?').run(
          userId,
          item.id,
        );
      } else {
        db.prepare(
          `INSERT INTO community_votes (userId, itemId, value, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(userId, itemId) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
        ).run(userId, item.id, value, now, now);
      }
      recalcCommunityScore(item.id);
    })();
    const updated = loadCommunityItem(item.id)!;
    return c.json({
      score: updated.score,
      viewerVote: viewerVote(userId, item.id),
    });
  });

  // POST /api/community/items/:id/clone
  app.post('/items/:id/clone', async (c) => {
    const userId = caller(c);
    const item = loadCommunityItem(c.req.param('id'));
    if (!item || !catalogVisible(item)) return c.json({ error: 'Not found' }, 404);
    const existing = cloneId(userId, item.id, item.language);
    if (existing) {
      return c.json({ cloned: false, reason: 'already-cloned', collectionId: existing });
    }

    const body = await c.req.json().catch(() => null);
    const groupId = body?.groupId;
    const groupName = body?.groupName;
    const hasGroupId = typeof groupId === 'string' && groupId.length > 0;
    const hasGroupName = typeof groupName === 'string' && groupName.trim().length > 0;
    if (hasGroupId === hasGroupName) {
      return c.json({ error: 'Send groupId or groupName, not both' }, 400);
    }
    if (hasGroupId) {
      const groupError = validateOwnedReference('collection_groups', groupId, userId, 'groupId');
      if (groupError) return c.json({ error: groupError }, 400);
    }

    const lessons = loadCommunityLessons(item.id);
    const now = new Date().toISOString();
    const collectionId = randomUUID();
    const lessonIds = lessons.map(() => randomUUID());

    const checks = [
      { metric: 'maxCollections' as const, requested: 1 },
      { metric: 'maxLessons' as const, requested: lessons.length },
      {
        metric: 'maxLessonTextBytes' as const,
        requested: Math.max(
          0,
          ...lessons.map((lesson) => lessonTextBytes(lesson.textContent, lesson.title)),
        ),
      },
      {
        metric: 'maxLessonTextBytesTotal' as const,
        requested: lessons.reduce(
          (sum, lesson) => sum + lessonTextBytes(lesson.textContent, lesson.title),
          0,
        ),
      },
      {
        metric: 'maxCollectionMetadataBytes' as const,
        requested: collectionMetadataBytes(item),
      },
      ...(hasGroupName
        ? [
            { metric: 'maxCollectionGroups' as const, requested: 1 },
            ...growingRowCheck('maxGroupNameBytes', utf8Bytes(groupName.trim())),
          ]
        : []),
    ];

    const verdict = entitlements.reserveCount(userId, checks, () => {
      let resolvedGroupId = hasGroupId ? groupId : null;
      if (hasGroupName) {
        resolvedGroupId = randomUUID();
        const maxOrder = db
          .prepare(
            'SELECT COALESCE(MAX(sortOrder), -1) as maxOrder FROM collection_groups WHERE userId = ?',
          )
          .get(userId) as { maxOrder: number };
        db.prepare(
          'INSERT INTO collection_groups (id, name, sortOrder, createdAt, userId) VALUES (?, ?, ?, ?, ?)',
        ).run(resolvedGroupId, groupName.trim(), maxOrder.maxOrder + 1, now, userId);
      }
      db.prepare(
        `INSERT INTO collections (
           id, title, author, coverUrl, groupId, language, createdAt, lastReadAt, userId, sourceCommunityItemId
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        collectionId,
        item.title,
        item.author,
        item.coverUrl,
        resolvedGroupId,
        item.language,
        now,
        now,
        userId,
        item.id,
      );
      const insertLesson = db.prepare(
        `INSERT INTO lessons (
           id, collectionId, title, sortOrder, textContent, wordCount, language,
           sourceType, sourceMeta, segments, createdAt, lastReadAt, userId
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      lessons.forEach((lesson, index) => {
        insertLesson.run(
          lessonIds[index],
          collectionId,
          lesson.title,
          lesson.sortOrder,
          lesson.textContent,
          lesson.wordCount,
          item.language,
          lesson.sourceType,
          lesson.sourceMeta,
          lesson.segments,
          now,
          now,
          userId,
        );
      });
    });
    if (!verdict.allowed) return planLimitResponse(c, verdict);

    return c.json({ cloned: true, collectionId, lessonCount: lessons.length });
  });

  return app;
}

export default makeCommunityRoutes({
  authRequired: config.authRequired,
  isAdminUser: (userId) => isAdmin(userId, adminConfig),
  submitterLabel: defaultSubmitterLabel,
});
