import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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

  // Initialize schema
  _db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      coverUrl TEXT,
      filePath TEXT NOT NULL,
      fileType TEXT NOT NULL CHECK (fileType IN ('epub', 'pdf', 'markdown')),
      progress_chapter INTEGER DEFAULT 0,
      progress_scrollPosition INTEGER DEFAULT 0,
      progress_percentComplete REAL DEFAULT 0,
      textContent TEXT,
      createdAt TEXT NOT NULL,
      lastReadAt TEXT NOT NULL
    );

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
      ankiNoteId INTEGER,
      FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE SET NULL
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

  return _db;
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

// Type definitions matching the Dexie models
export type WordState = 'new' | 'level1' | 'level2' | 'level3' | 'level4' | 'known' | 'ignored';
export type VocabType = 'word' | 'phrase';
export type ClozeMasteryLevel = 0 | 25 | 50 | 75 | 100;
export type ClozeSource = 'tatoeba' | 'mined';
export type ClozeCollection = 'top500' | 'top1000' | 'top2000' | 'mined' | 'random';
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
