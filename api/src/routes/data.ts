import { Hono } from 'hono';
import { db, SettingRow } from '../db';
import { getCurrentUserId } from '../lib/user';
import { SENSITIVE_KEYS, REDACTION_SENTINEL } from '../lib/settings-keys';
import { countWords } from '../lib/html-to-markdown';
import { randomUUID } from 'crypto';

const app = new Hono();

// GET /api/data — full backup. SELECT * dumps every column (incl. `language`)
// for every language, which is correct for a whole-DB backup. collection_groups
// is included so collections' groupId survives a restore.
app.get('/', (c) => {
  const userId = getCurrentUserId(c);
  const collections = db.prepare('SELECT * FROM collections WHERE userId = ?').all(userId);
  const collectionGroups = db
    .prepare('SELECT * FROM collection_groups WHERE userId = ?')
    .all(userId);
  const lessons = db.prepare('SELECT * FROM lessons WHERE userId = ?').all(userId);
  const vocab = db.prepare('SELECT * FROM vocab WHERE userId = ?').all(userId);
  const knownWords = db.prepare('SELECT * FROM knownWords WHERE userId = ?').all(userId);
  const clozeSentences = db.prepare('SELECT * FROM clozeSentences WHERE userId = ?').all(userId);
  const dailyStats = db.prepare('SELECT * FROM dailyStats WHERE userId = ?').all(userId);
  // Never export credentials: GET /api/settings masks them as `true`, so the
  // backup must not hand out the same keys in cleartext (#233). The sentinel
  // keeps the key visible in the backup; restore skips it (below).
  const settings = (
    db.prepare('SELECT * FROM settings WHERE userId = ?').all(userId) as SettingRow[]
  ).map((s) => (SENSITIVE_KEYS.has(s.key) ? { ...s, value: REDACTION_SENTINEL } : s));

  return c.json({
    exportedAt: new Date().toISOString(),
    collections,
    collectionGroups,
    lessons,
    vocab,
    knownWords,
    clozeSentences,
    dailyStats,
    settings,
  });
});

// POST /api/data — restore a backup.
//
// Every INSERT MUST list the full column set, including `language`. The
// partitioned tables (collections/lessons/vocab/knownWords/clozeSentences/
// dailyStats) carry a `language`, and knownWords + dailyStats have a compound
// (… , language) PK — so dropping the column doesn't just mislabel rows, it
// collapses rows from different languages onto the default 'af' key (data loss).
// Likewise list every value-bearing column (dailyStats.ankiReviews /
// sessionStartedAt, collections.groupId / sortOrder) so INSERT OR REPLACE doesn't
// reset them to defaults. Backups predating multi-language have no `language`
// field; defaulting to 'af' is correct for that legacy Afrikaans-only data.
app.post('/', async (c) => {
  // Restored rows belong to the requesting user regardless of any userId in
  // the backup payload — restoring a backup makes the data yours.
  const userId = getCurrentUserId(c);
  const data = await c.req.json();
  const results = {
    collections: 0,
    collectionGroups: 0,
    lessons: 0,
    vocab: 0,
    knownWords: 0,
    clozeSentences: 0,
    dailyStats: 0,
    settings: 0,
  };

  // The whole restore is one transaction (#237): a malformed row mid-import
  // must roll back everything rather than leave a half-restored DB with a
  // misleading partial count — and one commit beats hundreds of per-row WAL
  // autocommits. Every other multi-write path here already does this
  // (import.ts, known-words.ts).
  // Guarded upserts, not INSERT OR REPLACE, for every id-only-PK table below
  // (collection_groups/collections/lessons/vocab/clozeSentences). Their PK is
  // the bare id, so REPLACE would conflict on the GLOBAL id namespace — a
  // backup carrying another tenant's row id would delete their row and
  // re-create it under the restorer. `ON CONFLICT(id) DO UPDATE ... WHERE
  // table.userId = excluded.userId` overwrites your OWN row on a re-restore
  // but no-ops a foreign id (#220). The composite-PK tables (knownWords,
  // dailyStats, settings) keep REPLACE — userId is in their PK, so a foreign
  // row is a different key, never a clobber.
  db.transaction(() => {
    // Groups before collections so a restored collection's groupId resolves.
    if (data.collectionGroups?.length) {
      const stmt = db.prepare(`
      INSERT INTO collection_groups (id, name, sortOrder, createdAt, userId)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, sortOrder = excluded.sortOrder, createdAt = excluded.createdAt
      WHERE collection_groups.userId = excluded.userId
    `);
      for (const g of data.collectionGroups) {
        stmt.run(g.id, g.name, g.sortOrder || 0, g.createdAt || new Date().toISOString(), userId);
        results.collectionGroups++;
      }
    }

    if (data.collections?.length) {
      const stmt = db.prepare(`
      INSERT INTO collections (id, title, author, coverUrl, sortOrder, groupId, language, createdAt, lastReadAt, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, author = excluded.author, coverUrl = excluded.coverUrl,
        sortOrder = excluded.sortOrder, groupId = excluded.groupId, language = excluded.language,
        createdAt = excluded.createdAt, lastReadAt = excluded.lastReadAt
      WHERE collections.userId = excluded.userId
    `);
      for (const col of data.collections) {
        stmt.run(
          col.id,
          col.title,
          col.author || 'Unknown',
          col.coverUrl || null,
          col.sortOrder || 0,
          col.groupId || null,
          col.language || 'af',
          col.createdAt || new Date().toISOString(),
          col.lastReadAt || new Date().toISOString(),
          userId,
        );
        results.collections++;
      }
    }

    if (data.lessons?.length) {
      const stmt = db.prepare(`
      INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, progress_scrollPosition, progress_percentComplete, wordCount, language, createdAt, lastReadAt, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        collectionId = excluded.collectionId, title = excluded.title, sortOrder = excluded.sortOrder,
        textContent = excluded.textContent, progress_scrollPosition = excluded.progress_scrollPosition,
        progress_percentComplete = excluded.progress_percentComplete, wordCount = excluded.wordCount,
        language = excluded.language, createdAt = excluded.createdAt, lastReadAt = excluded.lastReadAt
      WHERE lessons.userId = excluded.userId
    `);
      for (const l of data.lessons) {
        stmt.run(
          l.id,
          l.collectionId || null,
          l.title,
          l.sortOrder || 0,
          l.textContent || '',
          l.progress_scrollPosition || 0,
          l.progress_percentComplete || 0,
          l.wordCount || countWords(l.textContent || ''),
          l.language || 'af',
          l.createdAt || new Date().toISOString(),
          l.lastReadAt || new Date().toISOString(),
          userId,
        );
        results.lessons++;
      }
    }

    // Legacy: import old books as collections+lessons. Pre-dates multi-language, so
    // these are Afrikaans ('af'). Same guarded-upsert rule (book.id is
    // client-supplied); the lesson id is a fresh randomUUID so it never
    // conflicts, but stays guarded for uniformity.
    if (data.books?.length) {
      const insertCollection = db.prepare(`
      INSERT INTO collections (id, title, author, coverUrl, language, createdAt, lastReadAt, userId)
      VALUES (?, ?, ?, ?, 'af', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, author = excluded.author, coverUrl = excluded.coverUrl,
        language = excluded.language, createdAt = excluded.createdAt, lastReadAt = excluded.lastReadAt
      WHERE collections.userId = excluded.userId
    `);
      const insertLesson = db.prepare(`
      INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, progress_scrollPosition, progress_percentComplete, wordCount, language, createdAt, lastReadAt, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'af', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        collectionId = excluded.collectionId, title = excluded.title, sortOrder = excluded.sortOrder,
        textContent = excluded.textContent, progress_scrollPosition = excluded.progress_scrollPosition,
        progress_percentComplete = excluded.progress_percentComplete, wordCount = excluded.wordCount,
        language = excluded.language, createdAt = excluded.createdAt, lastReadAt = excluded.lastReadAt
      WHERE lessons.userId = excluded.userId
    `);

      for (const book of data.books) {
        const collectionId = book.id;
        insertCollection.run(
          collectionId,
          book.title,
          book.author || 'Unknown',
          book.coverUrl || null,
          book.createdAt || new Date().toISOString(),
          book.lastReadAt || new Date().toISOString(),
          userId,
        );
        results.collections++;

        const textContent = book.textContent || '';
        insertLesson.run(
          randomUUID(),
          collectionId,
          book.title,
          0,
          textContent,
          book.progress?.scrollPosition ?? book.progress_scrollPosition ?? 0,
          book.progress?.percentComplete ?? book.progress_percentComplete ?? 0,
          countWords(textContent),
          book.createdAt || new Date().toISOString(),
          book.lastReadAt || new Date().toISOString(),
          userId,
        );
        results.lessons++;
      }
    }

    if (data.vocab?.length) {
      const stmt = db.prepare(`
      INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, reviewCount, bookId, chapter, language, createdAt, pushedToAnki, ankiNoteId, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        text = excluded.text, type = excluded.type, sentence = excluded.sentence,
        translation = excluded.translation, state = excluded.state, stateUpdatedAt = excluded.stateUpdatedAt,
        reviewCount = excluded.reviewCount, bookId = excluded.bookId, chapter = excluded.chapter,
        language = excluded.language, createdAt = excluded.createdAt,
        pushedToAnki = excluded.pushedToAnki, ankiNoteId = excluded.ankiNoteId
      WHERE vocab.userId = excluded.userId
    `);

      for (const v of data.vocab) {
        stmt.run(
          v.id,
          v.text,
          v.type || 'word',
          v.sentence || '',
          v.translation || '',
          v.state || 'new',
          v.stateUpdatedAt || new Date().toISOString(),
          v.reviewCount || 0,
          v.bookId || null,
          v.chapter || null,
          v.language || 'af',
          v.createdAt || new Date().toISOString(),
          v.pushedToAnki ? 1 : 0,
          v.ankiNoteId || null,
          userId,
        );
        results.vocab++;
      }
    }

    if (data.knownWords?.length) {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO knownWords (userId, word, language, state) VALUES (?, ?, ?, ?)',
      );
      for (const w of data.knownWords) {
        stmt.run(userId, w.word, w.language || 'af', w.state);
        results.knownWords++;
      }
    }

    if (data.clozeSentences?.length) {
      const stmt = db.prepare(`
      INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, vocabEntryId, masteryLevel, nextReview, reviewCount, lastReviewed, timesCorrect, timesIncorrect, blacklisted, language, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        sentence = excluded.sentence, clozeWord = excluded.clozeWord, clozeIndex = excluded.clozeIndex,
        translation = excluded.translation, source = excluded.source, collection = excluded.collection,
        wordRank = excluded.wordRank, tatoebaSentenceId = excluded.tatoebaSentenceId,
        vocabEntryId = excluded.vocabEntryId, masteryLevel = excluded.masteryLevel,
        nextReview = excluded.nextReview, reviewCount = excluded.reviewCount, lastReviewed = excluded.lastReviewed,
        timesCorrect = excluded.timesCorrect, timesIncorrect = excluded.timesIncorrect,
        blacklisted = excluded.blacklisted, language = excluded.language
      WHERE clozeSentences.userId = excluded.userId
    `);

      for (const cs of data.clozeSentences) {
        stmt.run(
          cs.id,
          cs.sentence,
          cs.clozeWord,
          cs.clozeIndex,
          cs.translation,
          cs.source || 'tatoeba',
          cs.collection || 'random',
          cs.wordRank || null,
          cs.tatoebaSentenceId || null,
          cs.vocabEntryId || null,
          cs.masteryLevel || 0,
          cs.nextReview || new Date().toISOString(),
          cs.reviewCount || 0,
          cs.lastReviewed || null,
          cs.timesCorrect || 0,
          cs.timesIncorrect || 0,
          cs.blacklisted ?? 0,
          cs.language || 'af',
          userId,
        );
        results.clozeSentences++;
      }
    }

    if (data.dailyStats?.length) {
      const stmt = db.prepare(`
      INSERT OR REPLACE INTO dailyStats (date, language, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups, ankiReviews, sessionStartedAt, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

      for (const s of data.dailyStats) {
        stmt.run(
          s.date,
          s.language || 'af',
          s.wordsRead || 0,
          s.newWordsSaved || 0,
          s.wordsMarkedKnown || 0,
          s.minutesRead || 0,
          s.clozePracticed || 0,
          s.points || 0,
          s.dictionaryLookups || 0,
          s.ankiReviews || 0,
          s.sessionStartedAt || null,
          userId,
        );
        results.dailyStats++;
      }
    }

    if (data.settings?.length) {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO settings (userId, key, value) VALUES (?, ?, ?)',
      );
      for (const s of data.settings) {
        const value = typeof s.value === 'string' ? s.value : JSON.stringify(s.value);
        // Redacted exports carry a sentinel for credential keys — never
        // overwrite a real stored key with it (#233).
        if (value === REDACTION_SENTINEL || value === JSON.stringify(REDACTION_SENTINEL)) continue;
        stmt.run(userId, s.key, value);
        results.settings++;
      }
    }
  })();

  return c.json({ success: true, imported: results });
});

export default app;
