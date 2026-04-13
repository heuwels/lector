import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { parseEpub } from './lib/epub-parser';
import { htmlToMarkdown, countWords } from './lib/html-to-markdown';

const DATA_DIR = process.env.DATA_DIR || '../data';
const DB_PATH = path.join(DATA_DIR, 'afrikaans.db');
export const BOOKS_DIR = path.join(DATA_DIR, 'books');

let _db: Database | null = null;

function getDb(): Database {
  if (_db) return _db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BOOKS_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.exec('PRAGMA journal_mode = WAL');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT 'Unknown',
      coverUrl TEXT,
      createdAt TEXT NOT NULL,
      lastReadAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      collectionId TEXT,
      title TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      textContent TEXT NOT NULL DEFAULT '',
      progress_scrollPosition INTEGER DEFAULT 0,
      progress_percentComplete REAL DEFAULT 0,
      wordCount INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL,
      lastReadAt TEXT NOT NULL,
      FOREIGN KEY (collectionId) REFERENCES collections(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lessons_collectionId ON lessons(collectionId);
    CREATE INDEX IF NOT EXISTS idx_lessons_sortOrder ON lessons(collectionId, sortOrder);

    CREATE TABLE IF NOT EXISTS vocab (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('word', 'phrase')),
      sentence TEXT NOT NULL,
      translation TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('new', 'level1', 'level2', 'level3', 'level4', 'known', 'ignored')),
      stateUpdatedAt TEXT NOT NULL,
      reviewCount INTEGER DEFAULT 0,
      bookId TEXT,
      chapter INTEGER,
      createdAt TEXT NOT NULL,
      pushedToAnki INTEGER DEFAULT 0,
      ankiNoteId INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_vocab_text ON vocab(text);
    CREATE INDEX IF NOT EXISTS idx_vocab_state ON vocab(state);
    CREATE INDEX IF NOT EXISTS idx_vocab_bookId ON vocab(bookId);

    CREATE TABLE IF NOT EXISTS knownWords (
      word TEXT PRIMARY KEY,
      state TEXT NOT NULL CHECK (state IN ('new', 'level1', 'level2', 'level3', 'level4', 'known', 'ignored'))
    );

    CREATE TABLE IF NOT EXISTS clozeSentences (
      id TEXT PRIMARY KEY,
      sentence TEXT NOT NULL,
      clozeWord TEXT NOT NULL,
      clozeIndex INTEGER NOT NULL,
      translation TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('tatoeba', 'mined')),
      collection TEXT NOT NULL CHECK (collection IN ('top500', 'top1000', 'top2000', 'mined', 'random')),
      wordRank INTEGER,
      tatoebaSentenceId INTEGER,
      vocabEntryId TEXT,
      masteryLevel INTEGER DEFAULT 0 CHECK (masteryLevel IN (0, 25, 50, 75, 100)),
      nextReview TEXT NOT NULL,
      reviewCount INTEGER DEFAULT 0,
      lastReviewed TEXT,
      timesCorrect INTEGER DEFAULT 0,
      timesIncorrect INTEGER DEFAULT 0,
      blacklisted INTEGER DEFAULT 0,
      FOREIGN KEY (vocabEntryId) REFERENCES vocab(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cloze_collection ON clozeSentences(collection);
    CREATE INDEX IF NOT EXISTS idx_cloze_nextReview ON clozeSentences(nextReview);
    CREATE INDEX IF NOT EXISTS idx_cloze_clozeWord ON clozeSentences(clozeWord);
    CREATE INDEX IF NOT EXISTS idx_cloze_masteryLevel ON clozeSentences(masteryLevel);

    CREATE TABLE IF NOT EXISTS dailyStats (
      date TEXT PRIMARY KEY,
      wordsRead INTEGER DEFAULT 0,
      newWordsSaved INTEGER DEFAULT 0,
      wordsMarkedKnown INTEGER DEFAULT 0,
      minutesRead INTEGER DEFAULT 0,
      clozePracticed INTEGER DEFAULT 0,
      points INTEGER DEFAULT 0,
      dictionaryLookups INTEGER DEFAULT 0,
      sessionStartedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrations for existing databases
  const cols = _db.prepare("PRAGMA table_info(dailyStats)").all() as { name: string }[];
  if (!cols.some(c => c.name === 'sessionStartedAt')) {
    _db.exec('ALTER TABLE dailyStats ADD COLUMN sessionStartedAt TEXT');
  }

  const clozeCols = _db.prepare("PRAGMA table_info(clozeSentences)").all() as { name: string }[];
  if (!clozeCols.some(c => c.name === 'blacklisted')) {
    _db.exec('ALTER TABLE clozeSentences ADD COLUMN blacklisted INTEGER DEFAULT 0');
  }

  migrateVocabForeignKey(_db);
  migrateBooks(_db);

  return _db;
}

function migrateVocabForeignKey(database: Database) {
  const createSql = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='vocab'"
  ).get() as { sql: string } | undefined;

  if (!createSql || !createSql.sql.includes('REFERENCES books')) return;

  database.transaction(() => {
    database.exec(`
      CREATE TABLE vocab_new (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('word', 'phrase')),
        sentence TEXT NOT NULL,
        translation TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('new', 'level1', 'level2', 'level3', 'level4', 'known', 'ignored')),
        stateUpdatedAt TEXT NOT NULL,
        reviewCount INTEGER DEFAULT 0,
        bookId TEXT,
        chapter INTEGER,
        createdAt TEXT NOT NULL,
        pushedToAnki INTEGER DEFAULT 0,
        ankiNoteId INTEGER
      );
      INSERT INTO vocab_new SELECT * FROM vocab;
      DROP TABLE vocab;
      ALTER TABLE vocab_new RENAME TO vocab;
      CREATE INDEX IF NOT EXISTS idx_vocab_text ON vocab(text);
      CREATE INDEX IF NOT EXISTS idx_vocab_state ON vocab(state);
      CREATE INDEX IF NOT EXISTS idx_vocab_bookId ON vocab(bookId);
    `);
  })();
}

interface BookRow {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  filePath: string;
  fileType: 'epub' | 'pdf' | 'markdown';
  progress_chapter: number;
  progress_scrollPosition: number;
  progress_percentComplete: number;
  textContent: string | null;
  createdAt: string;
  lastReadAt: string;
}

function migrateBooks(database: Database) {
  const tables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='books'"
  ).all();
  if (tables.length === 0) return;

  const books = database.prepare('SELECT * FROM books').all() as BookRow[];
  if (books.length === 0) {
    database.exec('DROP TABLE IF EXISTS books');
    return;
  }

  const now = new Date().toISOString();

  const insertCollection = database.prepare(`
    INSERT OR IGNORE INTO collections (id, title, author, coverUrl, createdAt, lastReadAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertLesson = database.prepare(`
    INSERT OR IGNORE INTO lessons (id, collectionId, title, sortOrder, textContent, progress_scrollPosition, progress_percentComplete, wordCount, createdAt, lastReadAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  database.transaction(() => {
    for (const book of books) {
      const collectionId = book.id;

      if (book.fileType === 'epub' && book.filePath && fs.existsSync(book.filePath)) {
        try {
          const buffer = fs.readFileSync(book.filePath);
          const parsed = parseEpub(buffer);

          insertCollection.run(
            collectionId, parsed.title || book.title, parsed.author || book.author,
            book.coverUrl, book.createdAt, book.lastReadAt
          );

          for (let i = 0; i < parsed.chapters.length; i++) {
            const chapter = parsed.chapters[i];
            insertLesson.run(
              randomUUID(), collectionId, chapter.title, i,
              chapter.markdown, 0, 0, chapter.wordCount,
              book.createdAt, book.lastReadAt
            );
          }

          fs.unlinkSync(book.filePath);
        } catch (err) {
          console.error(`Failed to parse EPUB ${book.title}:`, err);
          insertCollection.run(collectionId, book.title, book.author, book.coverUrl, book.createdAt, book.lastReadAt);
          insertLesson.run(
            randomUUID(), collectionId, book.title, 0,
            book.textContent || '(EPUB could not be parsed)',
            book.progress_scrollPosition, book.progress_percentComplete, 0,
            book.createdAt, book.lastReadAt
          );
        }
      } else {
        const textContent = book.textContent || (book.filePath && fs.existsSync(book.filePath)
          ? fs.readFileSync(book.filePath, 'utf-8')
          : '');

        insertCollection.run(collectionId, book.title, book.author, book.coverUrl, book.createdAt, book.lastReadAt);
        insertLesson.run(
          randomUUID(), collectionId, book.title, 0, textContent,
          book.progress_scrollPosition, book.progress_percentComplete,
          countWords(textContent), book.createdAt, book.lastReadAt
        );

        if (book.filePath && fs.existsSync(book.filePath)) {
          fs.unlinkSync(book.filePath);
        }
      }
    }

    database.exec('DROP TABLE IF EXISTS books');
  })();
}

// Export a lazy-init proxy
export const db = new Proxy({} as Database, {
  get(_target, prop) {
    const realDb = getDb();
    const value = (realDb as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return (value as Function).bind(realDb);
    }
    return value;
  },
});

// Type definitions
export type WordState = 'new' | 'level1' | 'level2' | 'level3' | 'level4' | 'known' | 'ignored';
export type VocabType = 'word' | 'phrase';
export type ClozeMasteryLevel = 0 | 25 | 50 | 75 | 100;
export type ClozeSource = 'tatoeba' | 'mined';
export type ClozeCollection = 'top500' | 'top1000' | 'top2000' | 'mined' | 'random';

export interface CollectionRow {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  createdAt: string;
  lastReadAt: string;
}

export interface LessonRow {
  id: string;
  collectionId: string | null;
  title: string;
  sortOrder: number;
  textContent: string;
  progress_scrollPosition: number;
  progress_percentComplete: number;
  wordCount: number;
  createdAt: string;
  lastReadAt: string;
}

export interface VocabRow {
  id: string;
  text: string;
  type: VocabType;
  sentence: string;
  translation: string;
  state: WordState;
  stateUpdatedAt: string;
  reviewCount: number;
  bookId: string | null;
  chapter: number | null;
  createdAt: string;
  pushedToAnki: number;
  ankiNoteId: number | null;
}

export interface KnownWordRow {
  word: string;
  state: WordState;
}

export interface ClozeSentenceRow {
  id: string;
  sentence: string;
  clozeWord: string;
  clozeIndex: number;
  translation: string;
  source: ClozeSource;
  collection: ClozeCollection;
  wordRank: number | null;
  tatoebaSentenceId: number | null;
  vocabEntryId: string | null;
  masteryLevel: ClozeMasteryLevel;
  nextReview: string;
  reviewCount: number;
  lastReviewed: string | null;
  timesCorrect: number;
  timesIncorrect: number;
  blacklisted: number;
}

export interface DailyStatsRow {
  date: string;
  wordsRead: number;
  newWordsSaved: number;
  wordsMarkedKnown: number;
  minutesRead: number;
  clozePracticed: number;
  points: number;
  dictionaryLookups: number;
  sessionStartedAt: string | null;
}

export interface SettingRow {
  key: string;
  value: string;
}
