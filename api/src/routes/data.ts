import { Hono } from 'hono';
import { db } from '../db';
import { countWords } from '../lib/html-to-markdown';
import { randomUUID } from 'crypto';

const app = new Hono();

// GET /api/data
app.get('/', (c) => {
  const collections = db.prepare('SELECT * FROM collections').all();
  const lessons = db.prepare('SELECT * FROM lessons').all();
  const vocab = db.prepare('SELECT * FROM vocab').all();
  const knownWords = db.prepare('SELECT * FROM knownWords').all();
  const clozeSentences = db.prepare('SELECT * FROM clozeSentences').all();
  const dailyStats = db.prepare('SELECT * FROM dailyStats').all();
  const settings = db.prepare('SELECT * FROM settings').all();

  return c.json({
    exportedAt: new Date().toISOString(),
    collections, lessons, vocab, knownWords, clozeSentences, dailyStats, settings,
  });
});

// POST /api/data
app.post('/', async (c) => {
  const data = await c.req.json();
  const results = {
    collections: 0, lessons: 0, vocab: 0, knownWords: 0,
    clozeSentences: 0, dailyStats: 0, settings: 0,
  };

  if (data.collections?.length) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO collections (id, title, author, coverUrl, createdAt, lastReadAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const col of data.collections) {
      stmt.run(col.id, col.title, col.author || 'Unknown', col.coverUrl || null,
        col.createdAt || new Date().toISOString(), col.lastReadAt || new Date().toISOString());
      results.collections++;
    }
  }

  if (data.lessons?.length) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO lessons (id, collectionId, title, sortOrder, textContent, progress_scrollPosition, progress_percentComplete, wordCount, createdAt, lastReadAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of data.lessons) {
      stmt.run(l.id, l.collectionId || null, l.title, l.sortOrder || 0,
        l.textContent || '', l.progress_scrollPosition || 0, l.progress_percentComplete || 0,
        l.wordCount || countWords(l.textContent || ''),
        l.createdAt || new Date().toISOString(), l.lastReadAt || new Date().toISOString());
      results.lessons++;
    }
  }

  // Legacy: import old books as collections+lessons
  if (data.books?.length) {
    const insertCollection = db.prepare(`
      INSERT OR REPLACE INTO collections (id, title, author, coverUrl, createdAt, lastReadAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertLesson = db.prepare(`
      INSERT OR REPLACE INTO lessons (id, collectionId, title, sortOrder, textContent, progress_scrollPosition, progress_percentComplete, wordCount, createdAt, lastReadAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const book of data.books) {
      const collectionId = book.id;
      insertCollection.run(collectionId, book.title, book.author || 'Unknown',
        book.coverUrl || null, book.createdAt || new Date().toISOString(),
        book.lastReadAt || new Date().toISOString());
      results.collections++;

      const textContent = book.textContent || '';
      insertLesson.run(randomUUID(), collectionId, book.title, 0, textContent,
        book.progress?.scrollPosition ?? book.progress_scrollPosition ?? 0,
        book.progress?.percentComplete ?? book.progress_percentComplete ?? 0,
        countWords(textContent),
        book.createdAt || new Date().toISOString(), book.lastReadAt || new Date().toISOString());
      results.lessons++;
    }
  }

  if (data.vocab?.length) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, reviewCount, bookId, chapter, createdAt, pushedToAnki, ankiNoteId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const v of data.vocab) {
      stmt.run(
        v.id, v.text, v.type || 'word', v.sentence || '', v.translation || '',
        v.state || 'new', v.stateUpdatedAt || new Date().toISOString(),
        v.reviewCount || 0, v.bookId || null, v.chapter || null,
        v.createdAt || new Date().toISOString(), v.pushedToAnki ? 1 : 0,
        v.ankiNoteId || null
      );
      results.vocab++;
    }
  }

  if (data.knownWords?.length) {
    const stmt = db.prepare('INSERT OR REPLACE INTO knownWords (word, state) VALUES (?, ?)');
    for (const w of data.knownWords) {
      stmt.run(w.word, w.state);
      results.knownWords++;
    }
  }

  if (data.clozeSentences?.length) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, vocabEntryId, masteryLevel, nextReview, reviewCount, lastReviewed, timesCorrect, timesIncorrect)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const cs of data.clozeSentences) {
      stmt.run(
        cs.id, cs.sentence, cs.clozeWord, cs.clozeIndex, cs.translation,
        cs.source || 'tatoeba', cs.collection || 'random', cs.wordRank || null,
        cs.tatoebaSentenceId || null, cs.vocabEntryId || null, cs.masteryLevel || 0,
        cs.nextReview || new Date().toISOString(), cs.reviewCount || 0,
        cs.lastReviewed || null, cs.timesCorrect || 0, cs.timesIncorrect || 0
      );
      results.clozeSentences++;
    }
  }

  if (data.dailyStats?.length) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO dailyStats (date, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const s of data.dailyStats) {
      stmt.run(s.date, s.wordsRead || 0, s.newWordsSaved || 0, s.wordsMarkedKnown || 0,
        s.minutesRead || 0, s.clozePracticed || 0, s.points || 0, s.dictionaryLookups || 0);
      results.dailyStats++;
    }
  }

  if (data.settings?.length) {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const s of data.settings) {
      const value = typeof s.value === 'string' ? s.value : JSON.stringify(s.value);
      stmt.run(s.key, value);
      results.settings++;
    }
  }

  return c.json({ success: true, imported: results });
});

export default app;
