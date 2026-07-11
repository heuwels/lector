import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { parseEpub } from './lib/epub-parser';
import { countWords } from './lib/html-to-markdown';
import {
  DEFAULT_LANGUAGE,
  foldWord,
  getLanguageConfig,
  isValidLanguageCode,
  normalizeText,
  LanguageCode,
} from './lib/languages';

const DATA_DIR = process.env.DATA_DIR || '../data';
const OLD_DB_PATH = path.join(DATA_DIR, 'afrikaans.db');
const DB_PATH = path.join(DATA_DIR, 'lector.db');
export const BOOKS_DIR = path.join(DATA_DIR, 'books');

let _db: Database | null = null;

function getDb(): Database {
  if (_db) return _db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BOOKS_DIR, { recursive: true });

  // Migrate DB filename: afrikaans.db -> lector.db
  if (!fs.existsSync(DB_PATH)) {
    try {
      fs.renameSync(OLD_DB_PATH, DB_PATH);
    } catch {
      /* old file doesn't exist or already moved */
    }
  }

  _db = new Database(DB_PATH);
  _db.exec('PRAGMA journal_mode = WAL');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT 'Unknown',
      coverUrl TEXT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
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
      ankiReviews INTEGER DEFAULT 0,
      sessionStartedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Per-account bring-your-own-key credentials. Secrets are application-
    -- encrypted before they reach SQLite and are deliberately separate from
    -- settings/data exports. The compound key leaves room for additional
    -- providers without ever sharing credentials between tenants.
    CREATE TABLE IF NOT EXISTS user_provider_credentials (
      userId TEXT NOT NULL,
      provider TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      model TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (userId, provider)
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

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      provider TEXT,
      responseId TEXT,
      createdAt TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'af'
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_createdAt ON chat_messages(createdAt);

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

    -- AI-translation cache. Persists structured AI translations after the user
    -- accepts them (Save to vocab / Mark Known / set level). The dictionary
    -- read-side falls through here when the read-only kaikki dict misses, so
    -- coverage of the user's reading corpus approaches 100% over time. Lives in
    -- lector.db (the mutable DB), not the read-only dictionary-af.db.
    CREATE TABLE IF NOT EXISTS cached_entries (
      word TEXT PRIMARY KEY,
      language TEXT NOT NULL DEFAULT 'af',
      ipa TEXT,
      etymology TEXT,
      sourceSentence TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cached_entries_language ON cached_entries(language);

    CREATE TABLE IF NOT EXISTS cached_senses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      pos TEXT,
      gloss TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (word) REFERENCES cached_entries(word) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cached_senses_word ON cached_senses(word);

    CREATE TABLE IF NOT EXISTS cached_related_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      related_word TEXT NOT NULL,
      relation TEXT NOT NULL,
      FOREIGN KEY (word) REFERENCES cached_entries(word) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cached_related_word ON cached_related_forms(word);

    -- Paddle billing mirror (#224). Written ONLY by the signature-verified
    -- webhook (routes/billing.ts); read by the billing gate (lib/billing.ts).
    -- Subscriptions link to an account by custom_data.lectorUserId (checkout
    -- opened in-app) or by customer email (checkout on lector.dev before the
    -- account existed) — hence the customers table: Paddle subscription
    -- events carry customer_id but never the email.
    CREATE TABLE IF NOT EXISTS billing_customers (
      paddleCustomerId TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      occurredAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_billing_customers_email ON billing_customers(email);

    CREATE TABLE IF NOT EXISTS billing_subscriptions (
      paddleSubscriptionId TEXT PRIMARY KEY,
      paddleCustomerId TEXT NOT NULL,
      userId TEXT,
      status TEXT NOT NULL,
      priceId TEXT,
      currentPeriodEnd TEXT,
      occurredAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_userId ON billing_subscriptions(userId);
    CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_customer ON billing_subscriptions(paddleCustomerId);

    -- Admin support flags (#221): manual per-account state the operator sets
    -- from the admin dashboard. Distinct from the Paddle billing mirror (that
    -- reflects Paddle; these are our own operator actions):
    --   - suspended: a lapse-style lock ("suspend an abuser"), enforced by
    --     accountStatusMiddleware (lib/admin.ts).
    --   - compedPlan: complimentary access at a specific tier ("comp a tester
    --     a Cloud/Plus membership") — NULL means not comped; 'cloud' | 'plus'
    --     grants that plan on the house. It bypasses the Paddle subscription
    --     gate (lib/billing.ts) and resolves the account to the comped tier's
    --     limits/models in the entitlements engine (lib/entitlements.ts).
    CREATE TABLE IF NOT EXISTS admin_account_flags (
      userId TEXT PRIMARY KEY,
      suspended INTEGER NOT NULL DEFAULT 0,
      compedPlan TEXT,
      reason TEXT,
      updatedAt TEXT NOT NULL
    );

    -- Admin audit log (#221 follow-up): append-only record of every operator
    -- action on an account (suspend/comp/reset-mfa/password-reset/…). The one
    -- accountability trail — actorUserId is the admin who acted, targetUserId
    -- the account acted on; detail carries a short human note (reason, tier).
    -- Named actor/target columns (not a plain userId) keep it off the tenant axis.
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actorUserId TEXT NOT NULL,
      actorEmail TEXT,
      action TEXT NOT NULL,
      targetUserId TEXT,
      targetEmail TEXT,
      detail TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_createdAt ON admin_audit_log(createdAt);

    -- Per-user monthly usage counters for the plan-limits engine (#222).
    -- period is a UTC calendar month ('2026-07'): the "monthly reset" is the
    -- period key rolling over — no cron, and history stays queryable for the
    -- admin dashboard (#221). Written via lib/entitlements.ts only.
    CREATE TABLE IF NOT EXISTS usage_counters (
      userId TEXT NOT NULL,
      metric TEXT NOT NULL,
      period TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (userId, metric, period)
    );

    -- Guided onboarding + learner activity (#331). The profile is deliberately
    -- small but durable: it is the first slice of the shared learner model
    -- planned in #125. Progress is one non-restartable v1 journey per account;
    -- events are append-only inputs shared by onboarding and future composers.
    CREATE TABLE IF NOT EXISTS learner_profiles (
      userId TEXT NOT NULL DEFAULT 'local',
      language TEXT NOT NULL,
      approximateLevel TEXT NOT NULL CHECK (approximateLevel IN ('new', 'beginner', 'intermediate', 'advanced', 'not_sure')),
      interests TEXT NOT NULL DEFAULT '[]',
      dailyMinutes INTEGER NOT NULL CHECK (dailyMinutes BETWEEN 5 AND 120),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (userId, language)
    );

    CREATE TABLE IF NOT EXISTS onboarding_progress (
      userId TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'skipped')),
      currentStep TEXT NOT NULL CHECK (currentStep IN ('reader', 'practice', 'summary')),
      language TEXT NOT NULL,
      starterCollectionId TEXT,
      recommendedLessonId TEXT,
      recommendedLessonTitle TEXT,
      nextLessonId TEXT,
      nextLessonTitle TEXT,
      startedAt TEXT NOT NULL,
      completedAt TEXT,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learner_events (
      userId TEXT NOT NULL DEFAULT 'local',
      id TEXT NOT NULL,
      eventType TEXT NOT NULL,
      language TEXT NOT NULL,
      lessonId TEXT,
      vocabId TEXT,
      properties TEXT NOT NULL DEFAULT '{}',
      idempotencyKey TEXT,
      occurredAt TEXT NOT NULL,
      PRIMARY KEY (userId, id)
    );
    CREATE INDEX IF NOT EXISTS idx_learner_events_user_occurred
      ON learner_events(userId, occurredAt);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_learner_events_user_idempotency
      ON learner_events(userId, idempotencyKey)
      WHERE idempotencyKey IS NOT NULL;

    -- Anki export queue (#241): cards the app wants created in Anki, pulled by
    -- the Lector addon (GET /api/anki/pending) and confirmed back (POST
    -- /api/anki/ack), which flips vocab.pushedToAnki. Rows reference vocab by
    -- (userId, id) without an FK: the pending read JOINs vocab, so a row whose
    -- entry was deleted simply never surfaces (and ack/queue clean up).
    -- word/sentence/translation/meaning override the vocab row's values when
    -- set — the reader's phrase-cloze and practice queue card content that
    -- differs from the stored entry (chosen blank, practice sentence).
    -- version increments on every re-queue; acks echo it so a stale ack (the
    -- addon confirming content it pulled before a re-queue) can never delete
    -- the newer row. Monotonic on purpose — same-millisecond timestamps tie.
    CREATE TABLE IF NOT EXISTS anki_pending (
      userId TEXT NOT NULL DEFAULT 'local',
      vocabId TEXT NOT NULL,
      cardType TEXT NOT NULL CHECK (cardType IN ('basic', 'word', 'cloze')),
      word TEXT,
      sentence TEXT,
      translation TEXT,
      meaning TEXT,
      queuedAt TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (userId, vocabId, cardType)
    );
  `);

  // Migrations for existing databases
  const cols = _db.prepare('PRAGMA table_info(dailyStats)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'sessionStartedAt')) {
    _db.exec('ALTER TABLE dailyStats ADD COLUMN sessionStartedAt TEXT');
  }

  const clozeCols = _db.prepare('PRAGMA table_info(clozeSentences)').all() as { name: string }[];
  if (!clozeCols.some((c) => c.name === 'blacklisted')) {
    _db.exec('ALTER TABLE clozeSentences ADD COLUMN blacklisted INTEGER DEFAULT 0');
  }

  const chatCols = _db.prepare('PRAGMA table_info(chat_messages)').all() as { name: string }[];
  if (!chatCols.some((c) => c.name === 'responseId')) {
    _db.exec('ALTER TABLE chat_messages ADD COLUMN responseId TEXT');
  }

  // anki_pending predating the stale-ack guard (#241 review): add the version
  // counter the ack round-trip now keys on.
  const ankiPendingCols = _db.prepare('PRAGMA table_info(anki_pending)').all() as {
    name: string;
  }[];
  if (ankiPendingCols.length > 0 && !ankiPendingCols.some((c) => c.name === 'version')) {
    _db.exec('ALTER TABLE anki_pending ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  }

  if (!chatCols.some((c) => c.name === 'language')) {
    _db.exec("ALTER TABLE chat_messages ADD COLUMN language TEXT NOT NULL DEFAULT 'af'");
  }

  // Drop the legacy UNIQUE constraint on journal_entries.entryDate (multiple
  // entries per day are allowed). Mirrors src/lib/server/database.ts.
  const journalIndex = _db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='journal_entries' AND name='idx_journal_entryDate'",
    )
    .get() as { name: string } | undefined;
  if (journalIndex) {
    const indexSql = _db
      .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_journal_entryDate'")
      .get() as { sql: string } | undefined;
    if (indexSql?.sql?.includes('UNIQUE')) {
      _db.exec('DROP INDEX idx_journal_entryDate');
      _db.exec('CREATE INDEX idx_journal_entryDate ON journal_entries(entryDate)');
    }
  }

  // collections.groupId / sortOrder — collection groups + manual ordering.
  // Mirrors src/lib/server/database.ts (both servers share the SQLite file).
  const collectionCols = _db.prepare('PRAGMA table_info(collections)').all() as { name: string }[];
  if (!collectionCols.some((col) => col.name === 'groupId')) {
    _db.exec(
      'ALTER TABLE collections ADD COLUMN groupId TEXT REFERENCES collection_groups(id) ON DELETE SET NULL',
    );
  }
  if (!collectionCols.some((col) => col.name === 'sortOrder')) {
    _db.exec('ALTER TABLE collections ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0');
  }

  migrateVocabForeignKey(_db);
  migrateBooks(_db);
  migrateAddLanguageColumn(_db);
  migrateCachedEntriesCompoundKey(_db);

  // dailyStats.ankiReviews — Anki reviews/day synced from AnkiConnect, counted
  // toward the activity heatmap + streak. Added after the language migration
  // (which recreates dailyStats) so the column survives the table rebuild.
  const dailyCols = _db.prepare('PRAGMA table_info(dailyStats)').all() as { name: string }[];
  if (!dailyCols.some((c) => c.name === 'ankiReviews')) {
    _db.exec('ALTER TABLE dailyStats ADD COLUMN ankiReviews INTEGER DEFAULT 0');
  }

  migrateLlmProviderSettings(_db);

  // knownWords.domain — topic-domain tag for the fluency radar, set lazily by
  // the background word-classifier (null = not yet classified). Added after
  // migrateAddLanguageColumn (which rebuilds knownWords for the compound PK) so
  // the column survives that rebuild.
  const knownWordsCols = _db.prepare('PRAGMA table_info(knownWords)').all() as { name: string }[];
  if (!knownWordsCols.some((c) => c.name === 'domain')) {
    _db.exec('ALTER TABLE knownWords ADD COLUMN domain TEXT');
  }

  // Runs last so the rebuild DDL below can assume every prior migration's
  // columns (language, domain, ankiReviews, …) already exist.
  migrateAddUserIdColumn(_db);

  // Runs after migrateAddUserIdColumn (needs the userId column) and before
  // ensurePartitionIndexes (the rebuilds drop every index on the way).
  migrateCompositeTenantKeys(_db);

  // Dead table from a long-removed translation-comparison experiment (DEBT-03).
  _db.exec('DROP TABLE IF EXISTS translation_evaluations');

  ensurePartitionIndexes(_db);

  // Runs every boot (idempotent, write-free when clean); after the schema
  // migrations so userId/language/domain all exist.
  migrateFoldWordKeys(_db);

  return _db;
}

// Merge-priority when two knownWords rows fold onto the same key: the most
// deliberate signal wins ('ignored' and 'known' are explicit user choices;
// levels rank by progress).
const FOLD_MERGE_PRIORITY: Record<string, number> = {
  ignored: 6,
  known: 5,
  level4: 4,
  level3: 3,
  level2: 2,
  level1: 1,
  new: 0,
};

/**
 * Re-key stored words through foldWord (#289 Phase 0, item 0.9): vocab keys
 * predating NFC normalization (decomposed macOS input, soft hyphens, odd
 * case) would no longer be hit by folded lookups. Runs every boot — cheap
 * scan, and only writes when it finds an unnormalized key. Rows whose keys
 * collide after folding are merged (highest FOLD_MERGE_PRIORITY state wins;
 * a classified domain survives a null one). vocab.text is display data, so
 * it is NFC-normalized in place without deduping (its PK is the id).
 * Exported for tests.
 */
export function migrateFoldWordKeys(database: Database) {
  const packFor = (language: string) =>
    getLanguageConfig(isValidLanguageCode(language) ? language : DEFAULT_LANGUAGE);

  const knownRows = database
    .prepare('SELECT userId, word, language, state, domain FROM knownWords')
    .all() as Array<{
    userId: string;
    word: string;
    language: string;
    state: string;
    domain: string | null;
  }>;
  const knownChanges = knownRows
    .map((row) => ({ row, folded: foldWord(row.word, packFor(row.language)) }))
    .filter(({ row, folded }) => folded !== row.word);

  const vocabRows = database.prepare('SELECT userId, id, text FROM vocab').all() as Array<{
    userId: string;
    id: string;
    text: string;
  }>;
  const vocabChanges = vocabRows
    .map((row) => ({ row, normalized: normalizeText(row.text) }))
    .filter(({ row, normalized }) => normalized !== row.text);

  if (knownChanges.length === 0 && vocabChanges.length === 0) return;

  const selectTarget = database.prepare(
    'SELECT state, domain FROM knownWords WHERE userId = ? AND word = ? AND language = ?',
  );
  const rekey = database.prepare(
    'UPDATE knownWords SET word = ? WHERE userId = ? AND word = ? AND language = ?',
  );
  const mergeTarget = database.prepare(
    'UPDATE knownWords SET state = ?, domain = ? WHERE userId = ? AND word = ? AND language = ?',
  );
  const dropLoser = database.prepare(
    'DELETE FROM knownWords WHERE userId = ? AND word = ? AND language = ?',
  );
  const retext = database.prepare('UPDATE vocab SET text = ? WHERE userId = ? AND id = ?');

  database.transaction(() => {
    for (const { row, folded } of knownChanges) {
      // Look up the live table each time: an earlier iteration may have
      // re-keyed another variant onto this row's folded key already.
      const target = selectTarget.get(row.userId, folded, row.language) as
        | { state: string; domain: string | null }
        | undefined;
      if (!target) {
        rekey.run(folded, row.userId, row.word, row.language);
        continue;
      }
      const winnerState =
        (FOLD_MERGE_PRIORITY[row.state] ?? 0) > (FOLD_MERGE_PRIORITY[target.state] ?? 0)
          ? row.state
          : target.state;
      mergeTarget.run(winnerState, target.domain ?? row.domain, row.userId, folded, row.language);
      dropLoser.run(row.userId, row.word, row.language);
    }
    for (const { row, normalized } of vocabChanges) {
      retext.run(normalized, row.userId, row.id);
    }
  })();

  console.log(
    `[db] fold-key migration: re-keyed ${knownChanges.length} known word(s), normalized ${vocabChanges.length} vocab text(s)`,
  );
}

/**
 * Composite indexes for the partitioned hot paths (#239, plan 008). Nearly
 * every user-data query filters WHERE userId = ? AND language = ?, but the
 * audit's EXPLAIN QUERY PLAN showed full SCANs on knownWords (reader per-open
 * + 2× per /fluency), vocab (scan + temp B-tree for ORDER BY createdAt),
 * clozeSentences (due/least-reviewed picks), and dailyStats — cost grows
 * linearly with vocabulary and bank size. Plan 008 predates the userId axis
 * (#217), so these lead with userId. vocab(userId, language, text) also backs
 * the single-row ?text= lookup (#240, plan 009).
 *
 * Must run after migrateAddLanguageColumn + migrateAddUserIdColumn (both
 * columns must exist, and those table rebuilds drop any indexes on the way).
 */
function ensurePartitionIndexes(database: Database) {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_knownWords_user_lang_state ON knownWords(userId, language, state);
    CREATE INDEX IF NOT EXISTS idx_vocab_user_lang_created ON vocab(userId, language, createdAt);
    CREATE INDEX IF NOT EXISTS idx_vocab_user_lang_state ON vocab(userId, language, state);
    CREATE INDEX IF NOT EXISTS idx_vocab_user_lang_text ON vocab(userId, language, text);
    CREATE INDEX IF NOT EXISTS idx_cloze_user_lang_nextReview ON clozeSentences(userId, language, nextReview);
    CREATE INDEX IF NOT EXISTS idx_cloze_user_lang_reviewCount ON clozeSentences(userId, language, reviewCount);
    CREATE INDEX IF NOT EXISTS idx_dailyStats_user_lang_date ON dailyStats(userId, language, date);
  `);
}

/**
 * The tenant axis (#217, plan 010 piece 2): every user-data table carries
 * userId, defaulted to the single implicit local user. A no-op for self-hosted
 * deployments (one user, 'local'); the isolation boundary for cloud (#218).
 * Same shape as migrateAddLanguageColumn: plain ALTER where the PK is
 * unaffected, guarded transactional rebuilds where userId joins the PK.
 * Shared read-only data (cached_entries/senses/related_forms, dictionaries,
 * sentence banks) deliberately stays global — see plan 010.
 */
function migrateAddUserIdColumn(database: Database) {
  const alterTables = [
    'collections',
    'lessons',
    'vocab',
    'clozeSentences',
    'journal_entries',
    'chat_messages',
    'collection_groups',
    'api_tokens',
  ];

  for (const table of alterTables) {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.length === 0) continue;
    if (!cols.some((c) => c.name === 'userId')) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN userId TEXT NOT NULL DEFAULT 'local'`);
    }
  }

  // knownWords: PK (word, language) -> (userId, word, language)
  const knownWordsSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='knownWords'")
    .get() as { sql: string } | undefined;
  if (knownWordsSql && !knownWordsSql.sql.includes('userId')) {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE knownWords_new (
          userId TEXT NOT NULL DEFAULT 'local',
          word TEXT NOT NULL,
          language TEXT NOT NULL DEFAULT 'af',
          state TEXT NOT NULL CHECK (state IN ('new', 'level1', 'level2', 'level3', 'level4', 'known', 'ignored')),
          domain TEXT,
          PRIMARY KEY (userId, word, language)
        );
        INSERT INTO knownWords_new (userId, word, language, state, domain)
          SELECT 'local', word, language, state, domain FROM knownWords;
        DROP TABLE knownWords;
        ALTER TABLE knownWords_new RENAME TO knownWords;
      `);
    })();
  }

  // dailyStats: PK (date, language) -> (userId, date, language)
  const dailyStatsSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='dailyStats'")
    .get() as { sql: string } | undefined;
  if (dailyStatsSql && !dailyStatsSql.sql.includes('userId')) {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE dailyStats_new (
          userId TEXT NOT NULL DEFAULT 'local',
          date TEXT NOT NULL,
          language TEXT NOT NULL DEFAULT 'af',
          wordsRead INTEGER DEFAULT 0,
          newWordsSaved INTEGER DEFAULT 0,
          wordsMarkedKnown INTEGER DEFAULT 0,
          minutesRead INTEGER DEFAULT 0,
          clozePracticed INTEGER DEFAULT 0,
          points INTEGER DEFAULT 0,
          dictionaryLookups INTEGER DEFAULT 0,
          ankiReviews INTEGER DEFAULT 0,
          sessionStartedAt TEXT,
          PRIMARY KEY (userId, date, language)
        );
        INSERT INTO dailyStats_new (userId, date, language, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups, ankiReviews, sessionStartedAt)
          SELECT 'local', date, language, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups, ankiReviews, sessionStartedAt FROM dailyStats;
        DROP TABLE dailyStats;
        ALTER TABLE dailyStats_new RENAME TO dailyStats;
      `);
    })();
  }

  // settings: PK (key) -> (userId, key). Every existing setting becomes the
  // local user's; which keys stay user-editable vs operator-only in cloud is
  // a #218 policy question, not a schema one.
  const settingsSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='settings'")
    .get() as { sql: string } | undefined;
  if (settingsSql && !settingsSql.sql.includes('userId')) {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE settings_new (
          userId TEXT NOT NULL DEFAULT 'local',
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (userId, key)
        );
        INSERT INTO settings_new (userId, key, value)
          SELECT 'local', key, value FROM settings;
        DROP TABLE settings;
        ALTER TABLE settings_new RENAME TO settings;
      `);
    })();
  }
}

/**
 * Composite (userId, id) primary keys for the synthetic-id tenant tables
 * (#279). W1 (#217) added userId as a plain column but left `id TEXT PRIMARY
 * KEY` alone, so ids stayed a GLOBAL namespace: any `INSERT OR REPLACE` (or
 * id-keyed upsert) with a caller-supplied id could collide with another
 * tenant's row and clobber it. PR #275 papered over the known write sites with
 * `ON CONFLICT(id) DO UPDATE … WHERE userId = excluded.userId` guards; this
 * rebuild makes the collision impossible at the schema level — the same id
 * under two tenants is simply two rows.
 *
 * Deliberately NOT a retained `UNIQUE(id)`: that would keep the global
 * namespace, and `INSERT OR REPLACE` replaces on ANY uniqueness violation —
 * i.e. it would preserve exactly the cross-tenant clobber this migration
 * exists to kill.
 *
 * Foreign keys: enforcement is off app-wide (see routes/groups.ts), so the
 * declarations are documentation. lessons.collectionId keeps a composite FK
 * (sound if ever enforced). The two ON DELETE SET NULL relations
 * (clozeSentences.vocabEntryId → vocab, collections.groupId →
 * collection_groups) lose their declarations: a composite FK with SET NULL
 * would null userId too (NOT NULL violation if ever enforced), and the routes
 * already do the cleanup manually (groups.ts ungroups; vocab deletes leave
 * cloze refs dangling, as they always have with enforcement off).
 *
 * Same discipline as the other rebuilds: guarded on the current PK shape,
 * transactional per table, idempotent. Exported for the migration tests.
 */
export function migrateCompositeTenantKeys(database: Database) {
  const REBUILDS: { table: string; createSql: string; columns: string[]; indexSql: string[] }[] = [
    {
      table: 'collection_groups',
      createSql: `
        CREATE TABLE collection_groups_new (
          userId TEXT NOT NULL DEFAULT 'local',
          id TEXT NOT NULL,
          name TEXT NOT NULL,
          sortOrder INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT NOT NULL,
          PRIMARY KEY (userId, id)
        )`,
      columns: ['userId', 'id', 'name', 'sortOrder', 'createdAt'],
      indexSql: [],
    },
    {
      table: 'collections',
      // groupId: no FK declaration — see the SET NULL note above.
      createSql: `
        CREATE TABLE collections_new (
          userId TEXT NOT NULL DEFAULT 'local',
          id TEXT NOT NULL,
          title TEXT NOT NULL,
          author TEXT NOT NULL DEFAULT 'Unknown',
          coverUrl TEXT,
          groupId TEXT,
          sortOrder INTEGER NOT NULL DEFAULT 0,
          language TEXT NOT NULL DEFAULT 'af',
          createdAt TEXT NOT NULL,
          lastReadAt TEXT NOT NULL,
          PRIMARY KEY (userId, id)
        )`,
      columns: [
        'userId',
        'id',
        'title',
        'author',
        'coverUrl',
        'groupId',
        'sortOrder',
        'language',
        'createdAt',
        'lastReadAt',
      ],
      indexSql: [],
    },
    {
      table: 'lessons',
      createSql: `
        CREATE TABLE lessons_new (
          userId TEXT NOT NULL DEFAULT 'local',
          id TEXT NOT NULL,
          collectionId TEXT,
          title TEXT NOT NULL,
          sortOrder INTEGER NOT NULL DEFAULT 0,
          textContent TEXT NOT NULL DEFAULT '',
          progress_scrollPosition INTEGER DEFAULT 0,
          progress_percentComplete REAL DEFAULT 0,
          wordCount INTEGER DEFAULT 0,
          language TEXT NOT NULL DEFAULT 'af',
          createdAt TEXT NOT NULL,
          lastReadAt TEXT NOT NULL,
          PRIMARY KEY (userId, id),
          FOREIGN KEY (userId, collectionId) REFERENCES collections(userId, id) ON DELETE CASCADE
        )`,
      columns: [
        'userId',
        'id',
        'collectionId',
        'title',
        'sortOrder',
        'textContent',
        'progress_scrollPosition',
        'progress_percentComplete',
        'wordCount',
        'language',
        'createdAt',
        'lastReadAt',
      ],
      indexSql: [
        'CREATE INDEX IF NOT EXISTS idx_lessons_collectionId ON lessons(collectionId)',
        'CREATE INDEX IF NOT EXISTS idx_lessons_sortOrder ON lessons(collectionId, sortOrder)',
      ],
    },
    {
      table: 'vocab',
      createSql: `
        CREATE TABLE vocab_new (
          userId TEXT NOT NULL DEFAULT 'local',
          id TEXT NOT NULL,
          text TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('word', 'phrase')),
          sentence TEXT NOT NULL,
          translation TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('new', 'level1', 'level2', 'level3', 'level4', 'known', 'ignored')),
          stateUpdatedAt TEXT NOT NULL,
          reviewCount INTEGER DEFAULT 0,
          bookId TEXT,
          chapter INTEGER,
          language TEXT NOT NULL DEFAULT 'af',
          createdAt TEXT NOT NULL,
          pushedToAnki INTEGER DEFAULT 0,
          ankiNoteId INTEGER,
          PRIMARY KEY (userId, id)
        )`,
      columns: [
        'userId',
        'id',
        'text',
        'type',
        'sentence',
        'translation',
        'state',
        'stateUpdatedAt',
        'reviewCount',
        'bookId',
        'chapter',
        'language',
        'createdAt',
        'pushedToAnki',
        'ankiNoteId',
      ],
      indexSql: [
        'CREATE INDEX IF NOT EXISTS idx_vocab_text ON vocab(text)',
        'CREATE INDEX IF NOT EXISTS idx_vocab_state ON vocab(state)',
        'CREATE INDEX IF NOT EXISTS idx_vocab_bookId ON vocab(bookId)',
      ],
    },
    {
      table: 'clozeSentences',
      // vocabEntryId: no FK declaration — see the SET NULL note above.
      createSql: `
        CREATE TABLE clozeSentences_new (
          userId TEXT NOT NULL DEFAULT 'local',
          id TEXT NOT NULL,
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
          language TEXT NOT NULL DEFAULT 'af',
          PRIMARY KEY (userId, id)
        )`,
      columns: [
        'userId',
        'id',
        'sentence',
        'clozeWord',
        'clozeIndex',
        'translation',
        'source',
        'collection',
        'wordRank',
        'tatoebaSentenceId',
        'vocabEntryId',
        'masteryLevel',
        'nextReview',
        'reviewCount',
        'lastReviewed',
        'timesCorrect',
        'timesIncorrect',
        'blacklisted',
        'language',
      ],
      indexSql: [
        'CREATE INDEX IF NOT EXISTS idx_cloze_collection ON clozeSentences(collection)',
        'CREATE INDEX IF NOT EXISTS idx_cloze_nextReview ON clozeSentences(nextReview)',
        'CREATE INDEX IF NOT EXISTS idx_cloze_clozeWord ON clozeSentences(clozeWord)',
        'CREATE INDEX IF NOT EXISTS idx_cloze_masteryLevel ON clozeSentences(masteryLevel)',
      ],
    },
    {
      table: 'chat_messages',
      createSql: `
        CREATE TABLE chat_messages_new (
          userId TEXT NOT NULL DEFAULT 'local',
          id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          provider TEXT,
          responseId TEXT,
          createdAt TEXT NOT NULL,
          language TEXT NOT NULL DEFAULT 'af',
          PRIMARY KEY (userId, id)
        )`,
      columns: [
        'userId',
        'id',
        'role',
        'content',
        'provider',
        'responseId',
        'createdAt',
        'language',
      ],
      indexSql: [
        'CREATE INDEX IF NOT EXISTS idx_chat_messages_createdAt ON chat_messages(createdAt)',
      ],
    },
    {
      table: 'journal_entries',
      createSql: `
        CREATE TABLE journal_entries_new (
          userId TEXT NOT NULL DEFAULT 'local',
          id TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '',
          correctedBody TEXT,
          corrections TEXT,
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
          wordCount INTEGER DEFAULT 0,
          language TEXT NOT NULL DEFAULT 'af',
          entryDate TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          PRIMARY KEY (userId, id)
        )`,
      columns: [
        'userId',
        'id',
        'body',
        'correctedBody',
        'corrections',
        'status',
        'wordCount',
        'language',
        'entryDate',
        'createdAt',
        'updatedAt',
      ],
      indexSql: [
        'CREATE INDEX IF NOT EXISTS idx_journal_entryDate ON journal_entries(entryDate)',
        'CREATE INDEX IF NOT EXISTS idx_journal_status ON journal_entries(status)',
      ],
    },
  ];

  for (const rebuild of REBUILDS) {
    const row = database
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
      .get(rebuild.table) as { sql: string } | undefined;
    if (!row || /PRIMARY KEY\s*\(\s*userId\s*,\s*id\s*\)/i.test(row.sql)) continue;

    const cols = rebuild.columns.join(', ');
    database.transaction(() => {
      database.exec(`
        ${rebuild.createSql};
        INSERT INTO ${rebuild.table}_new (${cols}) SELECT ${cols} FROM ${rebuild.table};
        DROP TABLE ${rebuild.table};
        ALTER TABLE ${rebuild.table}_new RENAME TO ${rebuild.table};
        ${rebuild.indexSql.map((s) => `${s};`).join('\n')}
      `);
    })();
  }
}

/**
 * Collapse the legacy per-provider LLM settings (ollama / apfel / lmstudio) onto
 * the unified OpenAI-compatible keys (openaiUrl / openaiModel / openaiApiKey).
 * Idempotent: it flips `llmProvider` to 'openai' once done, so it never re-runs.
 * Anthropic and unset/default installs are left untouched, and the old keys are
 * intentionally left in place (harmless, and keeps the change reversible).
 * Exported (not just called from getDb) so it can be unit-tested in isolation.
 */
export function migrateLlmProviderSettings(database: Database) {
  const getSetting = (key: string): unknown => {
    const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  };
  const setSetting = (key: string, value: unknown) => {
    database
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, JSON.stringify(value));
  };

  const provider = getSetting('llmProvider');
  if (provider !== 'ollama' && provider !== 'apfel' && provider !== 'lmstudio') return;

  database.transaction(() => {
    if (provider === 'ollama') {
      // Ollama had no URL setting (it used the OLLAMA_URL env var or a hardcoded
      // default), so leave openaiUrl unset and let the OLLAMA_URL env fallback
      // resolve it — writing a default here would break docker's
      // http://ollama:11434. Preserve the old default model.
      setSetting('openaiModel', getSetting('ollamaModel') || 'llama3.1:8b');
      setSetting('openaiPreset', 'ollama');
    } else if (provider === 'apfel') {
      const url = getSetting('apfelUrl');
      const model = getSetting('apfelModel');
      if (url) setSetting('openaiUrl', url);
      if (model) setSetting('openaiModel', model);
      setSetting('openaiPreset', 'custom');
    } else if (provider === 'lmstudio') {
      const url = getSetting('lmstudioUrl');
      const model = getSetting('lmstudioModel');
      const apiKey = getSetting('lmstudioApiKey');
      if (url) setSetting('openaiUrl', url);
      if (model) setSetting('openaiModel', model);
      if (apiKey) setSetting('openaiApiKey', apiKey);
      setSetting('openaiPreset', 'lmstudio');
    }
    setSetting('llmProvider', 'openai');
  })();
}

function migrateAddLanguageColumn(database: Database) {
  const tablesToMigrate = ['collections', 'lessons', 'vocab', 'clozeSentences', 'journal_entries'];

  for (const table of tablesToMigrate) {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    // Empty = table doesn't exist in this server's schema (journal_entries is
    // created by the Next side only) — nothing to migrate, and ALTER would throw.
    if (cols.length === 0) continue;
    if (!cols.some((c) => c.name === 'language')) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN language TEXT NOT NULL DEFAULT 'af'`);
    }
  }

  // Recreate knownWords with compound PK (word, language)
  const knownWordsSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='knownWords'")
    .get() as { sql: string } | undefined;

  if (knownWordsSql && !knownWordsSql.sql.includes('language')) {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE knownWords_new (
          word TEXT NOT NULL,
          language TEXT NOT NULL DEFAULT 'af',
          state TEXT NOT NULL CHECK (state IN ('new', 'level1', 'level2', 'level3', 'level4', 'known', 'ignored')),
          PRIMARY KEY (word, language)
        );
        INSERT INTO knownWords_new (word, language, state) SELECT word, 'af', state FROM knownWords;
        DROP TABLE knownWords;
        ALTER TABLE knownWords_new RENAME TO knownWords;
      `);
    })();
  }

  // Recreate dailyStats with compound PK (date, language)
  const dailyStatsSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='dailyStats'")
    .get() as { sql: string } | undefined;

  if (dailyStatsSql && !dailyStatsSql.sql.includes('language')) {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE dailyStats_new (
          date TEXT NOT NULL,
          language TEXT NOT NULL DEFAULT 'af',
          wordsRead INTEGER DEFAULT 0,
          newWordsSaved INTEGER DEFAULT 0,
          wordsMarkedKnown INTEGER DEFAULT 0,
          minutesRead INTEGER DEFAULT 0,
          clozePracticed INTEGER DEFAULT 0,
          points INTEGER DEFAULT 0,
          dictionaryLookups INTEGER DEFAULT 0,
          sessionStartedAt TEXT,
          PRIMARY KEY (date, language)
        );
        INSERT INTO dailyStats_new (date, language, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups, sessionStartedAt)
          SELECT date, 'af', wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups, sessionStartedAt FROM dailyStats;
        DROP TABLE dailyStats;
        ALTER TABLE dailyStats_new RENAME TO dailyStats;
      `);
    })();
  }
}

// Recreate cached_entries with a compound PK (word, language) so the same word
// can be cached per language, and carry `language` onto the sense / related-form
// children (FK on (word, language)). Mirrors the knownWords/dailyStats rebuilds:
// guarded, transactional, idempotent. cached_entries already has a `language`
// column (base schema), so existing children backfill their language from the
// parent via the join below. Foreign keys are off app-wide, so the rebuild is
// safe (and the FK declarations are documentation + future-proofing).
function migrateCachedEntriesCompoundKey(database: Database) {
  const cachedSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cached_entries'")
    .get() as { sql: string } | undefined;
  if (!cachedSql || /PRIMARY KEY\s*\(\s*word\s*,\s*language\s*\)/i.test(cachedSql.sql)) return;

  database.transaction(() => {
    database.exec(`
      CREATE TABLE cached_entries_new (
        word TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'af',
        ipa TEXT,
        etymology TEXT,
        sourceSentence TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (word, language)
      );
      INSERT INTO cached_entries_new (word, language, ipa, etymology, sourceSentence, createdAt, updatedAt)
        SELECT word, language, ipa, etymology, sourceSentence, createdAt, updatedAt FROM cached_entries;
      DROP TABLE cached_entries;
      ALTER TABLE cached_entries_new RENAME TO cached_entries;
      CREATE INDEX IF NOT EXISTS idx_cached_entries_language ON cached_entries(language);

      CREATE TABLE cached_senses_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'af',
        pos TEXT,
        gloss TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (word, language) REFERENCES cached_entries(word, language) ON DELETE CASCADE
      );
      INSERT INTO cached_senses_new (id, word, language, pos, gloss, sort_order)
        SELECT s.id, s.word, COALESCE(e.language, 'af'), s.pos, s.gloss, s.sort_order
        FROM cached_senses s LEFT JOIN cached_entries e ON e.word = s.word;
      DROP TABLE cached_senses;
      ALTER TABLE cached_senses_new RENAME TO cached_senses;
      CREATE INDEX IF NOT EXISTS idx_cached_senses_word ON cached_senses(word, language);

      CREATE TABLE cached_related_forms_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'af',
        related_word TEXT NOT NULL,
        relation TEXT NOT NULL,
        FOREIGN KEY (word, language) REFERENCES cached_entries(word, language) ON DELETE CASCADE
      );
      INSERT INTO cached_related_forms_new (id, word, language, related_word, relation)
        SELECT r.id, r.word, COALESCE(e.language, 'af'), r.related_word, r.relation
        FROM cached_related_forms r LEFT JOIN cached_entries e ON e.word = r.word;
      DROP TABLE cached_related_forms;
      ALTER TABLE cached_related_forms_new RENAME TO cached_related_forms;
      CREATE INDEX IF NOT EXISTS idx_cached_related_word ON cached_related_forms(word, language);
    `);
  })();
}

function migrateVocabForeignKey(database: Database) {
  const createSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vocab'")
    .get() as { sql: string } | undefined;

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
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='books'")
    .all();
  if (tables.length === 0) return;

  const books = database.prepare('SELECT * FROM books').all() as BookRow[];
  if (books.length === 0) {
    database.exec('DROP TABLE IF EXISTS books');
    return;
  }

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
            collectionId,
            parsed.title || book.title,
            parsed.author || book.author,
            book.coverUrl,
            book.createdAt,
            book.lastReadAt,
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
              book.lastReadAt,
            );
          }

          fs.unlinkSync(book.filePath);
        } catch (err) {
          console.error(`Failed to parse EPUB ${book.title}:`, err);
          insertCollection.run(
            collectionId,
            book.title,
            book.author,
            book.coverUrl,
            book.createdAt,
            book.lastReadAt,
          );
          insertLesson.run(
            randomUUID(),
            collectionId,
            book.title,
            0,
            book.textContent || '(EPUB could not be parsed)',
            book.progress_scrollPosition,
            book.progress_percentComplete,
            0,
            book.createdAt,
            book.lastReadAt,
          );
        }
      } else {
        const textContent =
          book.textContent ||
          (book.filePath && fs.existsSync(book.filePath)
            ? fs.readFileSync(book.filePath, 'utf-8')
            : '');

        insertCollection.run(
          collectionId,
          book.title,
          book.author,
          book.coverUrl,
          book.createdAt,
          book.lastReadAt,
        );
        insertLesson.run(
          randomUUID(),
          collectionId,
          book.title,
          0,
          textContent,
          book.progress_scrollPosition,
          book.progress_percentComplete,
          countWords(textContent),
          book.createdAt,
          book.lastReadAt,
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
    const value = (realDb as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(realDb);
    }
    return value;
  },
});

/**
 * The raw bun:sqlite handle behind the lazy proxy. Better Auth's adapter
 * detection inspects the instance itself (#218), which the proxy defeats —
 * everything else should keep importing `db`. Calling this boots the DB
 * (runs the lector migrations), same as first use of `db`.
 */
export function getDatabaseInstance(): Database {
  return getDb();
}

// Type definitions
export type WordState = 'new' | 'level1' | 'level2' | 'level3' | 'level4' | 'known' | 'ignored';
export type VocabType = 'word' | 'phrase';
export type ClozeMasteryLevel = 0 | 25 | 50 | 75 | 100;
export type ClozeSource = 'tatoeba' | 'mined';
export type ClozeCollection = 'top500' | 'top1000' | 'top2000' | 'mined' | 'random';

export interface CollectionRow {
  userId: string;
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  groupId: string | null;
  sortOrder: number;
  createdAt: string;
  lastReadAt: string;
}

export interface CollectionGroupRow {
  userId: string;
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
}

export type JournalStatus = 'draft' | 'submitted';

export interface JournalEntryRow {
  userId: string;
  id: string;
  body: string;
  correctedBody: string | null;
  corrections: string | null;
  status: JournalStatus;
  wordCount: number;
  language: string;
  entryDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface LessonRow {
  userId: string;
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
  userId: string;
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
  language: string;
  createdAt: string;
  pushedToAnki: number;
  ankiNoteId: number | null;
}

export interface KnownWordRow {
  userId: string;
  word: string;
  language: string;
  state: WordState;
}

export type AnkiCardType = 'basic' | 'word' | 'cloze';

export interface AnkiPendingRow {
  userId: string;
  vocabId: string;
  cardType: AnkiCardType;
  word: string | null;
  sentence: string | null;
  translation: string | null;
  meaning: string | null;
  queuedAt: string;
  version: number;
}

export interface ClozeSentenceRow {
  userId: string;
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
  userId: string;
  date: string;
  wordsRead: number;
  newWordsSaved: number;
  wordsMarkedKnown: number;
  minutesRead: number;
  clozePracticed: number;
  points: number;
  dictionaryLookups: number;
  ankiReviews: number;
  sessionStartedAt: string | null;
}

export interface SettingRow {
  userId: string;
  key: string;
  value: string;
}

export interface ApiTokenRow {
  userId: string;
  id: string;
  name: string;
  tokenHash: string;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface ChatMessageRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  provider: string | null;
  responseId: string | null;
  createdAt: string;
  language: LanguageCode;
}

export type ApproximateLevel = 'new' | 'beginner' | 'intermediate' | 'advanced' | 'not_sure';
export type OnboardingStatus = 'in_progress' | 'completed' | 'skipped';
export type OnboardingStep = 'reader' | 'practice' | 'summary';

export interface LearnerProfileRow {
  userId: string;
  language: LanguageCode;
  approximateLevel: ApproximateLevel;
  interests: string;
  dailyMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingProgressRow {
  userId: string;
  version: number;
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  language: LanguageCode;
  starterCollectionId: string | null;
  recommendedLessonId: string | null;
  recommendedLessonTitle: string | null;
  nextLessonId: string | null;
  nextLessonTitle: string | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface LearnerEventRow {
  userId: string;
  id: string;
  eventType: string;
  language: LanguageCode;
  lessonId: string | null;
  vocabId: string | null;
  properties: string;
  idempotencyKey: string | null;
  occurredAt: string;
}
