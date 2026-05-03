import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { parseEpub } from './epub-parser';
import { htmlToMarkdown, countWords } from '../html-to-markdown';

const DATA_DIR = process.env.DATA_DIR || './data';
const DB_PATH = path.join(DATA_DIR, 'afrikaans.db');
export const BOOKS_DIR = path.join(DATA_DIR, 'books');

// Lazy initialization to avoid build-time database access
let _db: DatabaseType | null = null;

function getDb(): DatabaseType {
  if (_db) return _db;

  // Ensure directories exist
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BOOKS_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');

  // Initialize schema — collections/lessons model
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

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tokenHash TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL DEFAULT '["*"]',
      createdAt TEXT NOT NULL,
      lastUsedAt TEXT,
      expiresAt TEXT
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL DEFAULT '',
      correctedBody TEXT,
      corrections TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
      wordCount INTEGER DEFAULT 0,
      entryDate TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_entryDate ON journal_entries(entryDate);
    CREATE INDEX IF NOT EXISTS idx_journal_status ON journal_entries(status);

    CREATE TABLE IF NOT EXISTS collection_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      provider TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_createdAt ON chat_messages(createdAt);
  `);

  // Migrations for existing databases

  // Drop unique constraint on journal_entries.entryDate (allow multiple entries per day)
  const journalIndexes = _db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='journal_entries' AND name='idx_journal_entryDate'").get() as { name: string } | undefined;
  if (journalIndexes) {
    const indexSql = _db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_journal_entryDate'").get() as { sql: string } | undefined;
    if (indexSql?.sql?.includes('UNIQUE')) {
      _db.exec('DROP INDEX idx_journal_entryDate');
      _db.exec('CREATE INDEX idx_journal_entryDate ON journal_entries(entryDate)');
    }
  }

  const cols = _db.prepare("PRAGMA table_info(dailyStats)").all() as { name: string }[];
  if (!cols.some(c => c.name === 'sessionStartedAt')) {
    _db.exec('ALTER TABLE dailyStats ADD COLUMN sessionStartedAt TEXT');
  }

  const clozeCols = _db.prepare("PRAGMA table_info(clozeSentences)").all() as { name: string }[];
  if (!clozeCols.some(c => c.name === 'blacklisted')) {
    _db.exec('ALTER TABLE clozeSentences ADD COLUMN blacklisted INTEGER DEFAULT 0');
  }

  const collectionCols = _db.prepare("PRAGMA table_info(collections)").all() as { name: string }[];
  if (!collectionCols.some(c => c.name === 'groupId')) {
    _db.exec('ALTER TABLE collections ADD COLUMN groupId TEXT REFERENCES collection_groups(id) ON DELETE SET NULL');
  }

  // Remove FK constraint on vocab.bookId that references old books table
  migrateVocabForeignKey(_db);

  // Migrate books → collections/lessons if books table exists
  migrateBooks(_db);

  return _db;
}

/**
 * Recreate vocab table without FK to books (which no longer exists).
 * Idempotent — checks if the FK exists before migrating.
 */
function migrateVocabForeignKey(database: DatabaseType) {
  // Check if vocab table has a FK referencing books
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

/**
 * Migrate old books table to collections + lessons.
 * Idempotent — only runs if books table exists.
 */
function migrateBooks(database: DatabaseType) {
  const tables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='books'"
  ).all();
  if (tables.length === 0) return;

  const books = database.prepare('SELECT * FROM books').all() as BookRow[];
  if (books.length === 0) {
    // No books, just drop the table
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

  const migrate = database.transaction(() => {
    for (const book of books) {
      const collectionId = book.id;

      if (book.fileType === 'epub' && book.filePath && fs.existsSync(book.filePath)) {
        // Parse EPUB into chapters
        try {
          const buffer = fs.readFileSync(book.filePath);
          const parsed = parseEpub(buffer);

          insertCollection.run(
            collectionId,
            parsed.title || book.title,
            parsed.author || book.author,
            book.coverUrl,
            book.createdAt,
            book.lastReadAt
          );

          for (let i = 0; i < parsed.chapters.length; i++) {
            const chapter = parsed.chapters[i];
            insertLesson.run(
              randomUUID(),
              collectionId,
              chapter.title,
              i,
              chapter.markdown,
              0,
              0,
              chapter.wordCount,
              book.createdAt,
              book.lastReadAt
            );
          }

          // Delete the original EPUB file
          fs.unlinkSync(book.filePath);
        } catch (err) {
          // EPUB parsing failed — create single-lesson collection with whatever text we have
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
        // Markdown or PDF — single-lesson collection
        const textContent = book.textContent || (book.filePath && fs.existsSync(book.filePath)
          ? fs.readFileSync(book.filePath, 'utf-8')
          : '');

        insertCollection.run(collectionId, book.title, book.author, book.coverUrl, book.createdAt, book.lastReadAt);
        insertLesson.run(
          randomUUID(), collectionId, book.title, 0,
          textContent,
          book.progress_scrollPosition, book.progress_percentComplete,
          countWords(textContent),
          book.createdAt, book.lastReadAt
        );

        // Clean up old file if it exists
        if (book.filePath && fs.existsSync(book.filePath)) {
          fs.unlinkSync(book.filePath);
        }
      }
    }

    // Drop the old books table
    database.exec('DROP TABLE IF EXISTS books');
  });

  migrate();
}

// Export a proxy that lazily initializes the database
export const db = new Proxy({} as DatabaseType, {
  get(_target, prop) {
    const realDb = getDb();
    const value = realDb[prop as keyof DatabaseType];
    if (typeof value === 'function') {
      return value.bind(realDb);
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

// Legacy type kept for migration only
export type BookFileType = 'epub' | 'pdf' | 'markdown';

export interface BookRow {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  filePath: string;
  fileType: BookFileType;
  progress_chapter: number;
  progress_scrollPosition: number;
  progress_percentComplete: number;
  textContent: string | null;
  createdAt: string;
  lastReadAt: string;
}

export interface CollectionRow {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  groupId: string | null;
  createdAt: string;
  lastReadAt: string;
}

export interface CollectionGroupRow {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
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

export type JournalStatus = 'draft' | 'submitted';

export interface ApiTokenRow {
  id: string;
  name: string;
  tokenHash: string;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface JournalEntryRow {
  id: string;
  body: string;
  correctedBody: string | null;
  corrections: string | null;
  status: JournalStatus;
  wordCount: number;
  entryDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  provider: string | null;
  createdAt: string;
}
