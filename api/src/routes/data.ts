import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { db } from '../db';
import { getCurrentUserId } from '../lib/user';
import { REDACTION_SENTINEL, validateSettingWrite } from '../lib/settings-keys';
import { buildUserExport } from '../lib/user-export';
import { countWords } from '../lib/html-to-markdown';
import {
  DEFAULT_LANGUAGE,
  foldWord,
  getLanguageConfig,
  isValidLanguageCode,
  normalizeText,
  type LanguageConfig,
} from '../lib/languages';
import { createHash, randomUUID } from 'crypto';
import {
  acceptedCacheContentBytes,
  acceptedCacheIdentity,
  cacheAcceptedEntry,
  validateCacheAcceptedInput,
  type CacheAcceptedInput,
} from '../lib/dictionary-db';
import { entitlements, planLimitResponse, type AtomicLimitCheck } from '../lib/entitlements';
import { FREE_RESTORE_ENVELOPE_BYTES } from '../lib/free-takeout-budget';
import { isClassifiedDomain } from '../lib/domains';
import { LEARNER_EVENT_TYPES, MAX_LEARNER_EVENT_PROPERTIES_BYTES } from '../lib/learner-events';
import {
  aggregateGrowthCheck,
  clozeContentBytes,
  collectionMetadataBytes,
  growingRowCheck,
  journalContentBytes,
  lessonTextBytes,
  MAX_PERSISTED_ID_BYTES,
  utf8Bytes,
  validatePersistedId,
  vocabContentBytes,
} from '../lib/storage-limits';

const app = new Hono();

export const MAX_RESTORE_BODY_BYTES = FREE_RESTORE_ENVELOPE_BYTES;
export const MAX_NON_FREE_RESTORE_BODY_BYTES = 256 * 1024 * 1024;
export const MAX_CONCURRENT_RESTORES = 1;

type RestoreAdmission =
  | { allowed: true; release: () => void }
  | { allowed: false; reason: 'user' | 'global' };

export class RestoreInFlightLimiter {
  private readonly activeUsers = new Set<string>();

  constructor(private readonly maxGlobal: number) {}

  acquire(userId: string): RestoreAdmission {
    if (this.activeUsers.has(userId)) return { allowed: false, reason: 'user' };
    if (this.activeUsers.size >= this.maxGlobal) return { allowed: false, reason: 'global' };

    this.activeUsers.add(userId);
    let active = true;
    return {
      allowed: true,
      release: () => {
        if (!active) return;
        active = false;
        this.activeUsers.delete(userId);
      },
    };
  }
}

const restoreLimiter = new RestoreInFlightLimiter(MAX_CONCURRENT_RESTORES);

// The guard runs before bodyLimit buffers the authenticated upload. A single
// account/process may have one restore buffered at a time, keeping peak parse
// memory bounded on a 2 GiB instance.
const restoreInFlightGuard = createMiddleware(async (c, next) => {
  const userId = getCurrentUserId(c);
  const admission = restoreLimiter.acquire(userId);
  if (!admission.allowed && admission.reason === 'user') {
    return c.json({ error: 'A restore is already in progress for this account' }, 409);
  }
  if (!admission.allowed) {
    return c.json({ error: 'Restore capacity is busy; try again shortly' }, 503);
  }

  try {
    await next();
  } finally {
    admission.release();
  }
});

// Free's finite storage envelope is proven to fit within 90 MiB. Paid and
// self-hosted accounts can legitimately export much larger uncapped libraries,
// so preserve a substantially larger, still finite process-memory guard for
// them instead of applying the Free product boundary to every plan.
const planAwareRestoreBodyLimit = createMiddleware((c, next) => {
  const userId = getCurrentUserId(c);
  const maxSize =
    entitlements.resolveEntitlements(userId).plan === 'free'
      ? MAX_RESTORE_BODY_BYTES
      : MAX_NON_FREE_RESTORE_BODY_BYTES;
  const maxMiB = maxSize / 1024 / 1024;
  return bodyLimit({
    maxSize,
    onError: (context) =>
      context.json({ error: `Backup is too large for this plan (max ${maxMiB} MiB)` }, 413),
  })(c, next);
});

// A backup is intentionally much larger than an interactive JSON request, but
// every collection still needs a finite row ceiling before we enter synchronous
// SQLite loops. These limits are above normal takeouts (including long-lived
// Plus accounts) while bounding a crafted payload whose rows contain only `{}`.
const RESTORE_ARRAY_LIMITS = {
  collectionGroups: 10_000,
  collections: 10_000,
  lessons: 25_000,
  books: 10_000,
  vocab: 100_000,
  knownWords: 100_000,
  clozeSentences: 100_000,
  journalEntries: 25_000,
  dailyStats: 25_000,
  acceptedDictionaryEntries: 25_000,
  learnerProfiles: 100,
  onboardingProgress: 10,
  learnerEvents: 100_000,
  settings: 1_000,
} as const;

type RestoreArrayKey = keyof typeof RESTORE_ARRAY_LIMITS;
// Legacy takeouts are intentionally field-permissive until each table's
// validation/preflight below; SQLite rejects an incompatible leaf inside the
// outer rollback transaction.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RestoreRow = Record<string, any>;
type RestorePayload = Partial<Record<RestoreArrayKey, RestoreRow[]>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && utf8Bytes(value) <= 64 && !Number.isNaN(Date.parse(value));
}

function validateOptionalTimestamp(row: RestoreRow, field: string, label: string): string | null {
  const value = row[field];
  if (value === undefined || value === null) return null;
  return isValidTimestamp(value)
    ? null
    : `${label}.${field} must be an ISO date of at most 64 bytes`;
}

function validateOptionalFiniteNumber(
  row: RestoreRow,
  field: string,
  label: string,
): string | null {
  const value = row[field];
  if (value === undefined || value === null) return null;
  return typeof value === 'number' && Number.isFinite(value)
    ? null
    : `${label}.${field} must be a finite number`;
}

const WORD_STATES = new Set(['new', 'level1', 'level2', 'level3', 'level4', 'known', 'ignored']);
const LEARNER_EVENT_TYPE_SET = new Set<string>(LEARNER_EVENT_TYPES);
const APPROXIMATE_LEVELS = new Set(['new', 'beginner', 'intermediate', 'advanced', 'not_sure']);
const LEARNER_INTERESTS = new Set([
  'everyday-life',
  'culture',
  'current-events',
  'literature',
  'faith-and-theology',
  'travel',
]);
const ONBOARDING_STATUSES = new Set(['in_progress', 'completed', 'skipped']);
const ONBOARDING_STEPS = new Set(['reader', 'practice', 'summary']);

function validateRestoreEnvelope(value: unknown): string | null {
  if (!isRecord(value)) return 'Backup must be a JSON object';

  for (const [key, limit] of Object.entries(RESTORE_ARRAY_LIMITS) as Array<
    [RestoreArrayKey, number]
  >) {
    const rows = value[key];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) return `${key} must be an array`;
    if (rows.length > limit) return `${key} exceeds the restore limit of ${limit} rows`;
    if (rows.some((row) => !isRecord(row))) return `${key} must contain only objects`;
  }

  for (const key of [
    'collectionGroups',
    'collections',
    'lessons',
    'books',
    'vocab',
    'clozeSentences',
    'journalEntries',
    'learnerEvents',
  ] as const) {
    const rows = value[key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Array<Record<string, unknown>>) {
      if (validatePersistedId(row.id)) {
        return `${key} rows require a control-free id of at most ${MAX_PERSISTED_ID_BYTES} UTF-8 bytes`;
      }
    }
  }

  for (const [key, field] of [
    ['collections', 'groupId'],
    ['lessons', 'collectionId'],
    ['vocab', 'bookId'],
    ['clozeSentences', 'vocabEntryId'],
  ] as const) {
    const rows = value[key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Array<Record<string, unknown>>) {
      if (row[field] !== undefined && row[field] !== null && validatePersistedId(row[field])) {
        return `${key}.${field} must be a control-free id of at most ${MAX_PERSISTED_ID_BYTES} UTF-8 bytes`;
      }
    }
  }

  if (value.exportedAt !== undefined && !isValidTimestamp(value.exportedAt)) {
    return 'exportedAt must be an ISO date of at most 64 bytes';
  }

  return null;
}

function legacyBookLessonId(bookId: string): string {
  return `legacy-book-${createHash('sha256').update(bookId).digest('hex')}`;
}

function countNetNewIds(
  table:
    | 'collection_groups'
    | 'collections'
    | 'lessons'
    | 'vocab'
    | 'clozeSentences'
    | 'journal_entries'
    | 'learner_events',
  userId: string,
  ids: readonly string[],
): number {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;

  const existing = new Set<string>();
  const chunkSize = 400; // comfortably below SQLite's variable ceiling
  for (let offset = 0; offset < unique.length; offset += chunkSize) {
    const chunk = unique.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id FROM ${table} WHERE userId = ? AND id IN (${placeholders})`)
      .all(userId, ...chunk) as Array<{ id: string }>;
    for (const row of rows) existing.add(row.id);
  }
  return unique.length - existing.size;
}

function existingOwnedIds(
  table: 'collection_groups' | 'collections' | 'lessons' | 'vocab',
  userId: string,
  ids: readonly string[],
): Set<string> {
  const unique = [...new Set(ids)];
  const existing = new Set<string>();
  for (let offset = 0; offset < unique.length; offset += 400) {
    const chunk = unique.slice(offset, offset + 400);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id FROM ${table} WHERE userId = ? AND id IN (${placeholders})`)
      .all(userId, ...chunk) as Array<{ id: string }>;
    for (const row of rows) existing.add(row.id);
  }
  return existing;
}

function existingBytesById(
  table:
    | 'collection_groups'
    | 'collections'
    | 'lessons'
    | 'vocab'
    | 'clozeSentences'
    | 'journal_entries'
    | 'learner_events',
  expression: string,
  userId: string,
  ids: readonly string[],
): Map<string, number> {
  const unique = [...new Set(ids)];
  const existing = new Map<string, number>();
  for (let offset = 0; offset < unique.length; offset += 350) {
    const chunk = unique.slice(offset, offset + 350);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT id, ${expression} AS bytes FROM ${table}
         WHERE userId = ? AND id IN (${placeholders})`,
      )
      .all(userId, ...chunk) as Array<{ id: string; bytes: number }>;
    for (const row of rows) existing.set(row.id, row.bytes);
  }
  return existing;
}

function byteGrowthStats<T>(
  rows: ReadonlyMap<string, T>,
  existing: ReadonlyMap<string, number>,
  bytesFor: (row: T) => number,
): { previous: number; next: number; largestGrowingRow: number } {
  let previous = 0;
  let next = 0;
  let largestGrowingRow = 0;
  for (const [id, row] of rows) {
    const before = existing.get(id) ?? 0;
    const after = bytesFor(row);
    previous += before;
    next += after;
    if (after > before) largestGrowingRow = Math.max(largestGrowingRow, after);
  }
  return { previous, next, largestGrowingRow };
}

function existingAcceptedBytes(userId: string): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT e.word, e.language,
        length(CAST(e.word AS BLOB)) +
        length(CAST(COALESCE(e.ipa, '') AS BLOB)) +
        length(CAST(COALESCE(e.etymology, '') AS BLOB)) +
        length(CAST(COALESCE(e.sourceSentence, '') AS BLOB)) +
        COALESCE(s.bytes, 0) + COALESCE(r.bytes, 0) AS bytes
       FROM cached_entries e
       LEFT JOIN (
         SELECT userId, word, language, SUM(
           length(CAST(COALESCE(pos, '') AS BLOB)) + length(CAST(gloss AS BLOB))
         ) AS bytes
         FROM cached_senses GROUP BY userId, word, language
       ) s ON s.userId = e.userId AND s.word = e.word AND s.language = e.language
       LEFT JOIN (
         SELECT userId, word, language, SUM(
           length(CAST(related_word AS BLOB)) + length(CAST(relation AS BLOB))
         ) AS bytes
         FROM cached_related_forms GROUP BY userId, word, language
       ) r ON r.userId = e.userId AND r.word = e.word AND r.language = e.language
       WHERE e.userId = ?`,
    )
    .all(userId) as Array<{ word: string; language: string; bytes: number }>;
  return new Map(rows.map((row) => [`${row.language}\0${row.word}`, row.bytes]));
}

// Restores must uphold the folded-key invariant (#289): a backup made before
// NFC/fold keying (or hand-edited) may carry unnormalized words, and the boot
// migration won't run again until the next restart.
function packFor(language: string | undefined | null): LanguageConfig {
  return getLanguageConfig(language && isValidLanguageCode(language) ? language : DEFAULT_LANGUAGE);
}

// GET /api/data — full backup for the requesting user. The builder
// (lib/user-export.ts) is shared with the admin export (#221) so both paths
// emit the same restore-ready shape.
app.get('/', (c) => {
  return c.json(buildUserExport(getCurrentUserId(c)));
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
app.post(
  '/',
  restoreInFlightGuard,
  planAwareRestoreBodyLimit,
  // Both restore guards must run before the callback buffers/parses JSON.
  async (c) => {
    // Restored rows belong to the requesting user regardless of any userId in
    // the backup payload — restoring a backup makes the data yours.
    const userId = getCurrentUserId(c);
    let rawData: unknown;
    try {
      rawData = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON body' }, 400);
    }
    const envelopeError = validateRestoreEnvelope(rawData);
    if (envelopeError) return c.json({ error: envelopeError }, 400);
    // validateRestoreEnvelope established the finite array-of-object boundary;
    // individual legacy row fields intentionally retain their permissive shape.
    const data = rawData as RestorePayload;

    for (const key of [
      'collections',
      'lessons',
      'vocab',
      'knownWords',
      'clozeSentences',
      'journalEntries',
      'dailyStats',
      'learnerProfiles',
      'onboardingProgress',
      'learnerEvents',
    ] as const) {
      for (const row of data[key] ?? []) {
        if (
          row.language !== undefined &&
          (typeof row.language !== 'string' || !isValidLanguageCode(row.language))
        ) {
          return c.json({ error: `${key} rows require a supported language` }, 400);
        }
      }
    }

    for (const row of data.collectionGroups ?? []) {
      if (typeof row.name !== 'string') {
        return c.json({ error: 'collectionGroups.name must be a string' }, 400);
      }
      const error =
        validateOptionalFiniteNumber(row, 'sortOrder', 'collectionGroups') ??
        validateOptionalTimestamp(row, 'createdAt', 'collectionGroups');
      if (error) return c.json({ error }, 400);
    }

    for (const [key, rows] of [
      ['collections', data.collections ?? []],
      ['books', data.books ?? []],
    ] as const) {
      for (const row of rows) {
        if (typeof row.title !== 'string') {
          return c.json({ error: `${key}.title must be a string` }, 400);
        }
        for (const field of ['author', 'coverUrl'] as const) {
          if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string') {
            return c.json({ error: `${key}.${field} must be a string or null` }, 400);
          }
        }
        const error =
          validateOptionalFiniteNumber(row, 'sortOrder', key) ??
          validateOptionalTimestamp(row, 'createdAt', key) ??
          validateOptionalTimestamp(row, 'lastReadAt', key);
        if (error) return c.json({ error }, 400);
      }
    }

    for (const row of data.lessons ?? []) {
      if (validatePersistedId(row.collectionId)) {
        return c.json(
          { error: 'lessons.collectionId must reference a non-empty persisted id' },
          400,
        );
      }
      if (typeof row.title !== 'string') {
        return c.json({ error: 'lessons.title must be a string' }, 400);
      }
      if (row.textContent !== undefined && typeof row.textContent !== 'string') {
        return c.json({ error: 'lessons.textContent must be a string' }, 400);
      }
      let error: string | null = null;
      for (const field of [
        'sortOrder',
        'progress_scrollPosition',
        'progress_percentComplete',
        'wordCount',
      ] as const) {
        error ??= validateOptionalFiniteNumber(row, field, 'lessons');
      }
      error ??= validateOptionalTimestamp(row, 'createdAt', 'lessons');
      error ??= validateOptionalTimestamp(row, 'lastReadAt', 'lessons');
      if (error) return c.json({ error }, 400);
    }

    for (const row of data.books ?? []) {
      if (row.textContent !== undefined && typeof row.textContent !== 'string') {
        return c.json({ error: 'books.textContent must be a string' }, 400);
      }
      for (const field of ['progress_scrollPosition', 'progress_percentComplete'] as const) {
        const error = validateOptionalFiniteNumber(row, field, 'books');
        if (error) return c.json({ error }, 400);
      }
      if (row.progress !== undefined) {
        if (!isRecord(row.progress))
          return c.json({ error: 'books.progress must be an object' }, 400);
        for (const field of ['scrollPosition', 'percentComplete'] as const) {
          const value = row.progress[field];
          if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
            return c.json({ error: `books.progress.${field} must be a finite number` }, 400);
          }
        }
      }
    }

    for (const row of data.vocab ?? []) {
      for (const field of ['text', 'sentence', 'translation'] as const) {
        if (row[field] !== undefined && typeof row[field] !== 'string') {
          return c.json({ error: `vocab.${field} must be a string` }, 400);
        }
      }
      if (row.type !== undefined && row.type !== 'word' && row.type !== 'phrase') {
        return c.json({ error: "vocab.type must be 'word' or 'phrase'" }, 400);
      }
      if (row.state !== undefined && !WORD_STATES.has(row.state)) {
        return c.json({ error: 'vocab.state is invalid' }, 400);
      }
      let error: string | null = null;
      for (const field of ['reviewCount', 'chapter', 'ankiNoteId'] as const) {
        error ??= validateOptionalFiniteNumber(row, field, 'vocab');
      }
      error ??= validateOptionalTimestamp(row, 'stateUpdatedAt', 'vocab');
      error ??= validateOptionalTimestamp(row, 'createdAt', 'vocab');
      if (error) return c.json({ error }, 400);
      if (
        row.pushedToAnki !== undefined &&
        row.pushedToAnki !== true &&
        row.pushedToAnki !== false &&
        row.pushedToAnki !== 0 &&
        row.pushedToAnki !== 1
      ) {
        return c.json({ error: 'vocab.pushedToAnki must be a boolean' }, 400);
      }
    }

    for (const row of data.knownWords ?? []) {
      if (typeof row.word !== 'string' || row.word.length === 0) {
        return c.json({ error: 'knownWords.word must be a non-empty string' }, 400);
      }
      if (!WORD_STATES.has(row.state)) {
        return c.json({ error: 'knownWords.state is invalid' }, 400);
      }
      if (
        row.domain !== undefined &&
        row.domain !== null &&
        (typeof row.domain !== 'string' || !isClassifiedDomain(row.domain))
      ) {
        return c.json({ error: 'knownWords.domain is invalid' }, 400);
      }
    }

    for (const row of data.clozeSentences ?? []) {
      for (const field of ['sentence', 'clozeWord', 'translation'] as const) {
        if (typeof row[field] !== 'string') {
          return c.json({ error: `clozeSentences.${field} must be a string` }, 400);
        }
      }
      if (row.source !== undefined && row.source !== 'tatoeba' && row.source !== 'mined') {
        return c.json({ error: 'clozeSentences.source is invalid' }, 400);
      }
      if (
        row.collection !== undefined &&
        !['top500', 'top1000', 'top2000', 'mined', 'random'].includes(row.collection)
      ) {
        return c.json({ error: 'clozeSentences.collection is invalid' }, 400);
      }
      if (row.masteryLevel !== undefined && ![0, 25, 50, 75, 100].includes(row.masteryLevel)) {
        return c.json({ error: 'clozeSentences.masteryLevel is invalid' }, 400);
      }
      if (!Number.isInteger(row.clozeIndex)) {
        return c.json({ error: 'clozeSentences.clozeIndex must be a finite integer' }, 400);
      }
      let error: string | null = null;
      for (const field of [
        'wordRank',
        'tatoebaSentenceId',
        'reviewCount',
        'timesCorrect',
        'timesIncorrect',
      ] as const) {
        error ??= validateOptionalFiniteNumber(row, field, 'clozeSentences');
      }
      error ??= validateOptionalTimestamp(row, 'nextReview', 'clozeSentences');
      error ??= validateOptionalTimestamp(row, 'lastReviewed', 'clozeSentences');
      if (error) return c.json({ error }, 400);
      if (
        row.blacklisted !== undefined &&
        row.blacklisted !== true &&
        row.blacklisted !== false &&
        row.blacklisted !== 0 &&
        row.blacklisted !== 1
      ) {
        return c.json({ error: 'clozeSentences.blacklisted must be a boolean' }, 400);
      }
    }

    const dailyNumericFields = [
      'wordsRead',
      'newWordsSaved',
      'wordsMarkedKnown',
      'minutesRead',
      'clozePracticed',
      'points',
      'dictionaryLookups',
      'ankiReviews',
    ] as const;
    for (const row of data.dailyStats ?? []) {
      if (!isValidDateKey(row.date)) {
        return c.json({ error: 'dailyStats rows require a valid YYYY-MM-DD date' }, 400);
      }
      for (const field of dailyNumericFields) {
        if (
          row[field] !== undefined &&
          (typeof row[field] !== 'number' || !Number.isFinite(row[field]))
        ) {
          return c.json({ error: `dailyStats.${field} must be a finite number` }, 400);
        }
      }
      if (
        row.sessionStartedAt !== undefined &&
        row.sessionStartedAt !== null &&
        !isValidTimestamp(row.sessionStartedAt)
      ) {
        return c.json({ error: 'dailyStats.sessionStartedAt must be an ISO date or null' }, 400);
      }
    }

    for (const row of data.journalEntries ?? []) {
      if (typeof row.body !== 'string') {
        return c.json({ error: 'journalEntries.body must be a string' }, 400);
      }
      if (row.status !== 'draft' && row.status !== 'submitted') {
        return c.json({ error: "journalEntries.status must be 'draft' or 'submitted'" }, 400);
      }
      if (!isValidDateKey(row.entryDate)) {
        return c.json({ error: 'journalEntries require a valid entryDate' }, 400);
      }
      if (
        row.correctedBody !== undefined &&
        row.correctedBody !== null &&
        typeof row.correctedBody !== 'string'
      ) {
        return c.json({ error: 'journalEntries.correctedBody must be a string or null' }, 400);
      }
      if (
        row.corrections !== undefined &&
        row.corrections !== null &&
        typeof row.corrections !== 'string'
      ) {
        return c.json({ error: 'journalEntries.corrections must be JSON text or null' }, 400);
      }
      if (typeof row.corrections === 'string') {
        try {
          JSON.parse(row.corrections);
        } catch {
          return c.json({ error: 'journalEntries.corrections must be valid JSON text' }, 400);
        }
      }
      for (const field of ['createdAt', 'updatedAt'] as const) {
        if (row[field] !== undefined && !isValidTimestamp(row[field])) {
          return c.json({ error: `journalEntries.${field} must be an ISO date` }, 400);
        }
      }
    }

    for (const row of data.learnerProfiles ?? []) {
      if (
        row.approximateLevel !== undefined &&
        (typeof row.approximateLevel !== 'string' || !APPROXIMATE_LEVELS.has(row.approximateLevel))
      ) {
        return c.json({ error: 'learnerProfiles.approximateLevel is invalid' }, 400);
      }
      let interests: unknown = row.interests ?? [];
      if (typeof interests === 'string') {
        try {
          interests = JSON.parse(interests);
        } catch {
          return c.json({ error: 'learnerProfiles.interests must be a JSON array' }, 400);
        }
      }
      if (
        !Array.isArray(interests) ||
        interests.length > LEARNER_INTERESTS.size ||
        interests.some(
          (interest) => typeof interest !== 'string' || !LEARNER_INTERESTS.has(interest),
        )
      ) {
        return c.json({ error: 'learnerProfiles.interests is invalid' }, 400);
      }
      row.interests = JSON.stringify([...new Set(interests)]);
      if (
        row.dailyMinutes !== undefined &&
        (!Number.isSafeInteger(row.dailyMinutes) || row.dailyMinutes < 5 || row.dailyMinutes > 120)
      ) {
        return c.json({ error: 'learnerProfiles.dailyMinutes must be between 5 and 120' }, 400);
      }
      for (const field of ['createdAt', 'updatedAt'] as const) {
        if (row[field] !== undefined && !isValidTimestamp(row[field])) {
          return c.json({ error: `learnerProfiles.${field} must be an ISO date` }, 400);
        }
      }
    }

    for (const row of data.onboardingProgress ?? []) {
      if (
        row.status !== undefined &&
        (typeof row.status !== 'string' || !ONBOARDING_STATUSES.has(row.status))
      ) {
        return c.json({ error: 'onboardingProgress.status is invalid' }, 400);
      }
      if (
        row.currentStep !== undefined &&
        (typeof row.currentStep !== 'string' || !ONBOARDING_STEPS.has(row.currentStep))
      ) {
        return c.json({ error: 'onboardingProgress.currentStep is invalid' }, 400);
      }
      if (row.version !== undefined && (!Number.isSafeInteger(row.version) || row.version < 1)) {
        return c.json({ error: 'onboardingProgress.version must be a positive integer' }, 400);
      }
      for (const field of ['starterCollectionId', 'recommendedLessonId', 'nextLessonId'] as const) {
        if (row[field] !== undefined && row[field] !== null) {
          const error = validatePersistedId(row[field]);
          if (error) return c.json({ error: `onboardingProgress.${field}: ${error}` }, 400);
        }
      }
      for (const field of ['recommendedLessonTitle', 'nextLessonTitle'] as const) {
        if (
          row[field] !== undefined &&
          row[field] !== null &&
          (typeof row[field] !== 'string' || utf8Bytes(row[field]) > 200)
        ) {
          return c.json({ error: `onboardingProgress.${field} is too long` }, 400);
        }
      }
      for (const field of ['startedAt', 'completedAt', 'updatedAt'] as const) {
        if (row[field] !== undefined && row[field] !== null && !isValidTimestamp(row[field])) {
          return c.json({ error: `onboardingProgress.${field} must be an ISO date` }, 400);
        }
      }
    }

    for (const row of data.learnerEvents ?? []) {
      if (typeof row.eventType !== 'string' || !LEARNER_EVENT_TYPE_SET.has(row.eventType)) {
        return c.json({ error: 'learnerEvents.eventType is invalid' }, 400);
      }
      for (const field of ['lessonId', 'vocabId'] as const) {
        if (row[field] !== undefined && row[field] !== null) {
          const error = validatePersistedId(row[field]);
          if (error) return c.json({ error: `learnerEvents.${field}: ${error}` }, 400);
        }
      }
      if (
        row.idempotencyKey !== undefined &&
        row.idempotencyKey !== null &&
        (typeof row.idempotencyKey !== 'string' ||
          row.idempotencyKey.length === 0 ||
          utf8Bytes(row.idempotencyKey) > 200)
      ) {
        return c.json({ error: 'learnerEvents.idempotencyKey is invalid' }, 400);
      }
      if (row.occurredAt !== undefined && !isValidTimestamp(row.occurredAt)) {
        return c.json({ error: 'learnerEvents.occurredAt must be an ISO date' }, 400);
      }
      let properties: unknown = row.properties ?? {};
      if (typeof properties === 'string') {
        try {
          properties = JSON.parse(properties);
        } catch {
          return c.json({ error: 'learnerEvents.properties must be valid JSON' }, 400);
        }
      }
      if (!isRecord(properties)) {
        return c.json({ error: 'learnerEvents.properties must be an object' }, 400);
      }
      const serialized = JSON.stringify(properties);
      if (utf8Bytes(serialized) > MAX_LEARNER_EVENT_PROPERTIES_BYTES) {
        return c.json({ error: 'learnerEvents.properties is too large' }, 400);
      }
      row.properties = serialized;
    }

    const restoreSettings: Array<{ key: string; value: string }> = [];
    for (const row of data.settings ?? []) {
      if (typeof row.key !== 'string') return c.json({ error: 'settings rows require a key' }, 400);
      const serialized = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
      if (serialized === REDACTION_SENTINEL || serialized === JSON.stringify(REDACTION_SENTINEL)) {
        continue;
      }
      if (serialized === undefined) {
        return c.json({ error: `Invalid setting ${row.key}: value is not serializable` }, 400);
      }
      let decoded: unknown = serialized;
      try {
        decoded = JSON.parse(serialized);
      } catch {
        // Legacy settings may contain a raw string rather than JSON text.
      }
      const settingError = validateSettingWrite(row.key, decoded);
      if (settingError)
        return c.json({ error: `Invalid setting ${row.key}: ${settingError}` }, 400);
      restoreSettings.push({ key: row.key, value: serialized });
    }

    const acceptedDictionaryEntries: CacheAcceptedInput[] = [];
    if (data.acceptedDictionaryEntries !== undefined) {
      if (!Array.isArray(data.acceptedDictionaryEntries)) {
        return c.json({ error: 'acceptedDictionaryEntries must be an array' }, 400);
      }
      for (const candidate of data.acceptedDictionaryEntries) {
        // Any userId embedded in a crafted backup is ignored; ownership always
        // binds to the authenticated restorer in cacheAcceptedEntry below.
        const validated = validateCacheAcceptedInput(candidate);
        if (!validated.ok) {
          return c.json({ error: `Invalid accepted dictionary entry: ${validated.error}` }, 400);
        }
        acceptedDictionaryEntries.push(validated.value);
      }
    }

    // Collapse duplicate incoming keys to their final value before calculating
    // storage deltas. The SQL below is also last-write-wins, so this measures
    // the state that will actually remain on disk rather than charging the
    // same id repeatedly within one backup.
    const finalGroups = new Map<string, RestoreRow>();
    for (const row of data.collectionGroups ?? []) finalGroups.set(row.id as string, row);

    const finalCollections = new Map<string, RestoreRow>();
    for (const row of data.collections ?? []) finalCollections.set(row.id as string, row);
    for (const book of data.books ?? []) {
      finalCollections.set(book.id as string, {
        id: book.id,
        title: book.title,
        author: book.author || 'Unknown',
        coverUrl: book.coverUrl || null,
      });
    }

    // Old takeouts can contain vocab whose optional source collection was
    // deleted. Vocabulary is portable on its own, so retain the row and clear
    // only that dangling pointer rather than rejecting the entire backup.
    const incomingCollectionIds = new Set(finalCollections.keys());
    const vocabBookReferences = (data.vocab ?? [])
      .map((row) => row.bookId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const existingCollectionIds = existingOwnedIds('collections', userId, vocabBookReferences);
    for (const row of data.vocab ?? []) {
      if (
        typeof row.bookId === 'string' &&
        row.bookId.length > 0 &&
        !incomingCollectionIds.has(row.bookId) &&
        !existingCollectionIds.has(row.bookId)
      ) {
        row.bookId = null;
      }
    }

    const finalLessons = new Map<string, RestoreRow>();
    for (const row of data.lessons ?? []) {
      finalLessons.set(row.id as string, {
        ...row,
        textContent: normalizeText(row.textContent || ''),
      });
    }
    for (const book of data.books ?? []) {
      finalLessons.set(legacyBookLessonId(book.id as string), {
        id: legacyBookLessonId(book.id as string),
        collectionId: book.id,
        title: book.title,
        textContent: normalizeText(book.textContent || ''),
      });
    }

    // `vocab.bookId` is the legacy name for a source lesson id. Very old
    // flat-book takeouts used the book id, so migrate those references to the
    // deterministic lesson created above. If a source lesson was deleted,
    // retain the portable vocab row and clear only its optional pointer.
    const legacyLessonIds = new Map(
      (data.books ?? []).map((book) => [book.id as string, legacyBookLessonId(book.id as string)]),
    );
    for (const row of data.vocab ?? []) {
      if (typeof row.bookId !== 'string' || row.bookId.length === 0) continue;
      row.bookId = legacyLessonIds.get(row.bookId) ?? row.bookId;
    }
    const incomingLessonIds = new Set(finalLessons.keys());
    const vocabBookReferences = (data.vocab ?? [])
      .map((row) => row.bookId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const existingLessonIds = existingOwnedIds('lessons', userId, vocabBookReferences);
    for (const row of data.vocab ?? []) {
      if (
        typeof row.bookId === 'string' &&
        row.bookId.length > 0 &&
        !incomingLessonIds.has(row.bookId) &&
        !existingLessonIds.has(row.bookId)
      ) {
        row.bookId = null;
      }
    }

    const finalVocab = new Map<string, RestoreRow>();
    for (const row of data.vocab ?? []) {
      finalVocab.set(row.id as string, {
        ...row,
        text: normalizeText(row.text ?? ''),
        sentence: row.sentence || '',
        translation: row.translation || '',
      });
    }
    const finalCloze = new Map<string, RestoreRow>();
    for (const row of data.clozeSentences ?? []) finalCloze.set(row.id as string, row);
    const finalJournal = new Map<string, RestoreRow>();
    for (const row of data.journalEntries ?? []) {
      finalJournal.set(row.id as string, {
        ...row,
        correctedBody: row.correctedBody ?? null,
        corrections: row.corrections ?? null,
      });
    }
    const finalLearnerEvents = new Map<string, RestoreRow>();
    for (const row of data.learnerEvents ?? []) {
      finalLearnerEvents.set(row.id as string, row);
    }

    const finalKnown = new Map<
      string,
      { word: string; language: string; state: string; domain: string | null }
    >();
    for (const row of data.knownWords ?? []) {
      const language = row.language || 'af';
      const word = foldWord(row.word ?? '', packFor(language));
      finalKnown.set(`${language}\0${word}`, {
        word,
        language,
        state: row.state,
        domain: row.domain ?? null,
      });
    }
    const existingKnown = new Set(
      (
        db.prepare('SELECT word, language FROM knownWords WHERE userId = ?').all(userId) as Array<{
          word: string;
          language: string;
        }>
      ).map((row) => `${row.language}\0${row.word}`),
    );
    const newKnown = [...finalKnown.entries()]
      .filter(([key]) => !existingKnown.has(key))
      .map(([, row]) => row);

    const finalDailyStats = new Map<string, RestoreRow>();
    for (const row of data.dailyStats ?? []) {
      const language = row.language || 'af';
      finalDailyStats.set(`${language}\0${row.date}`, { ...row, language });
    }
    const existingDailyStats = new Set(
      (
        db.prepare('SELECT date, language FROM dailyStats WHERE userId = ?').all(userId) as Array<{
          date: string;
          language: string;
        }>
      ).map((row) => `${row.language}\0${row.date}`),
    );
    const newDailyStats = [...finalDailyStats.keys()].filter(
      (key) => !existingDailyStats.has(key),
    ).length;

    const finalAccepted = new Map<string, CacheAcceptedInput>();
    for (const entry of acceptedDictionaryEntries) {
      const identity = acceptedCacheIdentity(entry);
      finalAccepted.set(`${identity.language}\0${identity.word}`, entry);
    }

    const referenceChecks = [
      {
        label: 'collections.groupId',
        table: 'collection_groups' as const,
        rows: [...finalCollections.values()],
        field: 'groupId',
        incomingTargets: new Set(finalGroups.keys()),
      },
      {
        label: 'lessons.collectionId',
        table: 'collections' as const,
        rows: [...finalLessons.values()],
        field: 'collectionId',
        incomingTargets: new Set(finalCollections.keys()),
      },
      {
        label: 'clozeSentences.vocabEntryId',
        table: 'vocab' as const,
        rows: [...finalCloze.values()],
        field: 'vocabEntryId',
        incomingTargets: new Set(finalVocab.keys()),
      },
    ];
    for (const check of referenceChecks) {
      const references = check.rows
        .map((row) => row[check.field])
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
      const existingTargets = existingOwnedIds(check.table, userId, references);
      const missing = references.find(
        (reference) => !check.incomingTargets.has(reference) && !existingTargets.has(reference),
      );
      if (missing) {
        return c.json({ error: `${check.label} references missing owned id: ${missing}` }, 400);
      }
    }
    const acceptedBefore = existingAcceptedBytes(userId);

    const groupBefore = existingBytesById(
      'collection_groups',
      'length(CAST(name AS BLOB))',
      userId,
      [...finalGroups.keys()],
    );
    const collectionBefore = existingBytesById(
      'collections',
      `length(CAST(title AS BLOB)) + length(CAST(author AS BLOB)) +
       length(CAST(COALESCE(coverUrl, '') AS BLOB))`,
      userId,
      [...finalCollections.keys()],
    );
    const lessonBefore = existingBytesById(
      'lessons',
      'length(CAST(title AS BLOB)) + length(CAST(textContent AS BLOB))',
      userId,
      [...finalLessons.keys()],
    );
    const vocabBefore = existingBytesById(
      'vocab',
      `length(CAST(text AS BLOB)) + length(CAST(sentence AS BLOB)) +
       length(CAST(translation AS BLOB))`,
      userId,
      [...finalVocab.keys()],
    );
    const clozeBefore = existingBytesById(
      'clozeSentences',
      `length(CAST(sentence AS BLOB)) + length(CAST(clozeWord AS BLOB)) +
       length(CAST(translation AS BLOB))`,
      userId,
      [...finalCloze.keys()],
    );
    const journalBefore = existingBytesById(
      'journal_entries',
      `length(CAST(body AS BLOB)) +
       length(CAST(COALESCE(correctedBody, '') AS BLOB)) +
       length(CAST(COALESCE(corrections, '') AS BLOB))`,
      userId,
      [...finalJournal.keys()],
    );
    const learnerEventBefore = existingBytesById(
      'learner_events',
      'length(CAST(properties AS BLOB))',
      userId,
      [...finalLearnerEvents.keys()],
    );

    const groupGrowth = byteGrowthStats(finalGroups, groupBefore, (row) => utf8Bytes(row.name));
    const collectionGrowth = byteGrowthStats(finalCollections, collectionBefore, (row) =>
      collectionMetadataBytes({
        title: row.title,
        author: row.author || 'Unknown',
        coverUrl: row.coverUrl || null,
      }),
    );
    const lessonGrowth = byteGrowthStats(finalLessons, lessonBefore, (row) =>
      lessonTextBytes(row.textContent, row.title),
    );
    const vocabGrowth = byteGrowthStats(finalVocab, vocabBefore, (row) => vocabContentBytes(row));
    const clozeGrowth = byteGrowthStats(finalCloze, clozeBefore, (row) => clozeContentBytes(row));
    const journalGrowth = byteGrowthStats(finalJournal, journalBefore, (row) =>
      journalContentBytes(row),
    );
    const learnerEventGrowth = byteGrowthStats(finalLearnerEvents, learnerEventBefore, (row) =>
      utf8Bytes(row.properties),
    );
    const acceptedGrowth = byteGrowthStats(
      finalAccepted,
      acceptedBefore,
      acceptedCacheContentBytes,
    );
    const knownGrowthBytes = newKnown.reduce((total, row) => total + utf8Bytes(row.word), 0);
    const largestNewKnown = newKnown.reduce(
      (largest, row) => Math.max(largest, utf8Bytes(row.word)),
      0,
    );

    const netNew = {
      groups: countNetNewIds('collection_groups', userId, [...finalGroups.keys()]),
      collections: countNetNewIds('collections', userId, [...finalCollections.keys()]),
      lessons: countNetNewIds('lessons', userId, [...finalLessons.keys()]),
      vocab: countNetNewIds('vocab', userId, [...finalVocab.keys()]),
      cloze: countNetNewIds('clozeSentences', userId, [...finalCloze.keys()]),
      journal: countNetNewIds('journal_entries', userId, [...finalJournal.keys()]),
      learnerEvents: countNetNewIds('learner_events', userId, [...finalLearnerEvents.keys()]),
      accepted: [...finalAccepted.keys()].filter((key) => !acceptedBefore.has(key)).length,
    };
    const storageChecks: AtomicLimitCheck[] = [
      ...(netNew.groups
        ? [{ metric: 'maxCollectionGroups' as const, requested: netNew.groups }]
        : []),
      ...(netNew.collections
        ? [{ metric: 'maxCollections' as const, requested: netNew.collections }]
        : []),
      ...(netNew.lessons ? [{ metric: 'maxLessons' as const, requested: netNew.lessons }] : []),
      ...(netNew.vocab ? [{ metric: 'maxVocabEntries' as const, requested: netNew.vocab }] : []),
      ...(newKnown.length
        ? [{ metric: 'maxKnownWords' as const, requested: newKnown.length }]
        : []),
      ...(newDailyStats
        ? [{ metric: 'maxDailyStatsRows' as const, requested: newDailyStats }]
        : []),
      ...(netNew.cloze ? [{ metric: 'maxClozeSentences' as const, requested: netNew.cloze }] : []),
      ...(netNew.journal
        ? [{ metric: 'maxJournalEntries' as const, requested: netNew.journal }]
        : []),
      ...(netNew.learnerEvents
        ? [{ metric: 'maxLearnerEvents' as const, requested: netNew.learnerEvents }]
        : []),
      ...(netNew.accepted
        ? [{ metric: 'maxAcceptedDictionaryEntries' as const, requested: netNew.accepted }]
        : []),
      ...growingRowCheck('maxGroupNameBytes', groupGrowth.largestGrowingRow),
      ...growingRowCheck('maxCollectionMetadataBytes', collectionGrowth.largestGrowingRow),
      ...growingRowCheck('maxLessonTextBytes', lessonGrowth.largestGrowingRow),
      ...aggregateGrowthCheck('maxLessonTextBytesTotal', lessonGrowth.next, lessonGrowth.previous),
      ...growingRowCheck('maxVocabEntryBytes', vocabGrowth.largestGrowingRow),
      ...aggregateGrowthCheck('maxVocabTextBytesTotal', vocabGrowth.next, vocabGrowth.previous),
      ...growingRowCheck('maxKnownWordBytes', largestNewKnown),
      ...aggregateGrowthCheck('maxKnownWordsTextBytesTotal', knownGrowthBytes),
      ...growingRowCheck('maxClozeEntryBytes', clozeGrowth.largestGrowingRow),
      ...aggregateGrowthCheck('maxClozeTextBytesTotal', clozeGrowth.next, clozeGrowth.previous),
      ...aggregateGrowthCheck(
        'maxAcceptedDictionaryBytesTotal',
        acceptedGrowth.next,
        acceptedGrowth.previous,
      ),
      ...growingRowCheck('maxJournalEntryBytes', journalGrowth.largestGrowingRow),
      ...aggregateGrowthCheck(
        'maxJournalTextBytesTotal',
        journalGrowth.next,
        journalGrowth.previous,
      ),
      ...growingRowCheck('maxLearnerEventBytes', learnerEventGrowth.largestGrowingRow),
    ];

    const results = {
      collections: 0,
      collectionGroups: 0,
      lessons: 0,
      vocab: 0,
      knownWords: 0,
      clozeSentences: 0,
      journalEntries: 0,
      dailyStats: 0,
      acceptedDictionaryEntries: 0,
      learnerProfiles: 0,
      onboardingProgress: 0,
      learnerEvents: 0,
      settings: 0,
    };

    // The whole restore is one transaction (#237): a malformed row mid-import
    // must roll back everything rather than leave a half-restored DB with a
    // misleading partial count — and one commit beats hundreds of per-row WAL
    // autocommits. Every other multi-write path here already does this
    // (import.ts, known-words.ts).
    // Every table below has userId in its PK (#217/#279), so ids are per-tenant:
    // a backup carrying another tenant's row id restores as the restorer's OWN
    // distinct row and can never touch theirs. The upserts conflict on
    // (userId, id) — re-restoring your own backup overwrites your rows in place.
    const verdict = entitlements.reserveCount(userId, storageChecks, () => {
      // Groups before collections so a restored collection's groupId resolves.
      if (data.collectionGroups?.length) {
        const stmt = db.prepare(`
      INSERT INTO collection_groups (id, name, sortOrder, createdAt, userId)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(userId, id) DO UPDATE SET
        name = excluded.name, sortOrder = excluded.sortOrder, createdAt = excluded.createdAt
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
      ON CONFLICT(userId, id) DO UPDATE SET
        title = excluded.title, author = excluded.author, coverUrl = excluded.coverUrl,
        sortOrder = excluded.sortOrder, groupId = excluded.groupId, language = excluded.language,
        createdAt = excluded.createdAt, lastReadAt = excluded.lastReadAt
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
      ON CONFLICT(userId, id) DO UPDATE SET
        collectionId = excluded.collectionId, title = excluded.title, sortOrder = excluded.sortOrder,
        textContent = excluded.textContent, progress_scrollPosition = excluded.progress_scrollPosition,
        progress_percentComplete = excluded.progress_percentComplete, wordCount = excluded.wordCount,
        language = excluded.language, createdAt = excluded.createdAt, lastReadAt = excluded.lastReadAt
    `);
        for (const l of data.lessons) {
          const textContent = normalizeText(l.textContent || '');
          stmt.run(
            l.id,
            l.collectionId || null,
            l.title,
            l.sortOrder || 0,
            textContent,
            l.progress_scrollPosition || 0,
            l.progress_percentComplete || 0,
            l.wordCount || countWords(textContent),
            l.language || 'af',
            l.createdAt || new Date().toISOString(),
            l.lastReadAt || new Date().toISOString(),
            userId,
          );
          results.lessons++;
        }
      }

      // Legacy: import old books as collections+lessons. Pre-dates multi-language, so
      // these are Afrikaans ('af'). Same (userId, id) upsert shape (book.id is
      // client-supplied). The derived lesson id is stable so retrying the same
      // legacy restore updates one row instead of minting an unbounded new lesson.
      if (data.books?.length) {
        const insertCollection = db.prepare(`
      INSERT INTO collections (id, title, author, coverUrl, language, createdAt, lastReadAt, userId)
      VALUES (?, ?, ?, ?, 'af', ?, ?, ?)
      ON CONFLICT(userId, id) DO UPDATE SET
        title = excluded.title, author = excluded.author, coverUrl = excluded.coverUrl,
        language = excluded.language, createdAt = excluded.createdAt, lastReadAt = excluded.lastReadAt
    `);
        const insertLesson = db.prepare(`
      INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, progress_scrollPosition, progress_percentComplete, wordCount, language, createdAt, lastReadAt, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'af', ?, ?, ?)
      ON CONFLICT(userId, id) DO UPDATE SET
        collectionId = excluded.collectionId, title = excluded.title, sortOrder = excluded.sortOrder,
        textContent = excluded.textContent, progress_scrollPosition = excluded.progress_scrollPosition,
        progress_percentComplete = excluded.progress_percentComplete, wordCount = excluded.wordCount,
        language = excluded.language, createdAt = excluded.createdAt, lastReadAt = excluded.lastReadAt
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

          const textContent = normalizeText(book.textContent || '');
          insertLesson.run(
            legacyBookLessonId(book.id),
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
      ON CONFLICT(userId, id) DO UPDATE SET
        text = excluded.text, type = excluded.type, sentence = excluded.sentence,
        translation = excluded.translation, state = excluded.state, stateUpdatedAt = excluded.stateUpdatedAt,
        reviewCount = excluded.reviewCount, bookId = excluded.bookId, chapter = excluded.chapter,
        language = excluded.language, createdAt = excluded.createdAt,
        pushedToAnki = excluded.pushedToAnki, ankiNoteId = excluded.ankiNoteId
    `);

        for (const v of data.vocab) {
          stmt.run(
            v.id,
            normalizeText(v.text ?? ''),
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
          'INSERT OR REPLACE INTO knownWords (userId, word, language, state, domain) VALUES (?, ?, ?, ?, ?)',
        );
        for (const w of data.knownWords) {
          stmt.run(
            userId,
            foldWord(w.word ?? '', packFor(w.language)),
            w.language || 'af',
            w.state,
            w.domain ?? null,
          );
          results.knownWords++;
        }
      }

      if (data.clozeSentences?.length) {
        const stmt = db.prepare(`
      INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, vocabEntryId, masteryLevel, nextReview, reviewCount, lastReviewed, timesCorrect, timesIncorrect, blacklisted, language, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId, id) DO UPDATE SET
        sentence = excluded.sentence, clozeWord = excluded.clozeWord, clozeIndex = excluded.clozeIndex,
        translation = excluded.translation, source = excluded.source, collection = excluded.collection,
        wordRank = excluded.wordRank, tatoebaSentenceId = excluded.tatoebaSentenceId,
        vocabEntryId = excluded.vocabEntryId, masteryLevel = excluded.masteryLevel,
        nextReview = excluded.nextReview, reviewCount = excluded.reviewCount, lastReviewed = excluded.lastReviewed,
        timesCorrect = excluded.timesCorrect, timesIncorrect = excluded.timesIncorrect,
        blacklisted = excluded.blacklisted, language = excluded.language
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

      if (data.journalEntries?.length) {
        const stmt = db.prepare(`
          INSERT INTO journal_entries
            (id, body, correctedBody, corrections, status, wordCount, entryDate, language, createdAt, updatedAt, userId)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(userId, id) DO UPDATE SET
            body = excluded.body, correctedBody = excluded.correctedBody,
            corrections = excluded.corrections, status = excluded.status,
            wordCount = excluded.wordCount, entryDate = excluded.entryDate,
            language = excluded.language, createdAt = excluded.createdAt,
            updatedAt = excluded.updatedAt
        `);
        for (const entry of data.journalEntries) {
          const now = new Date().toISOString();
          const wordCount = entry.body.trim().split(/\s+/).filter(Boolean).length;
          stmt.run(
            entry.id,
            entry.body,
            entry.correctedBody ?? null,
            entry.corrections ?? null,
            entry.status,
            wordCount,
            entry.entryDate,
            entry.language || 'af',
            entry.createdAt || now,
            entry.updatedAt || now,
            userId,
          );
          results.journalEntries++;
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

      // User-accepted AI entries are private learner data. The cache helper
      // replaces only this user's parent + children under the full tenant key,
      // making repeat restores idempotent without touching another account.
      for (const entry of acceptedDictionaryEntries) {
        if (!cacheAcceptedEntry(userId, entry)) {
          throw new Error(`Could not restore accepted dictionary entry ${entry.word}`);
        }
        results.acceptedDictionaryEntries++;
      }

      if (data.learnerProfiles?.length) {
        const stmt = db.prepare(`
          INSERT INTO learner_profiles
            (userId, language, approximateLevel, interests, dailyMinutes, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(userId, language) DO UPDATE SET
            approximateLevel = excluded.approximateLevel,
            interests = excluded.interests,
            dailyMinutes = excluded.dailyMinutes,
            createdAt = excluded.createdAt,
            updatedAt = excluded.updatedAt
        `);
        for (const profile of data.learnerProfiles) {
          const interests =
            typeof profile.interests === 'string'
              ? profile.interests
              : JSON.stringify(profile.interests ?? []);
          stmt.run(
            userId,
            profile.language || 'af',
            profile.approximateLevel || 'not_sure',
            interests,
            profile.dailyMinutes || 10,
            profile.createdAt || new Date().toISOString(),
            profile.updatedAt || new Date().toISOString(),
          );
          results.learnerProfiles++;
        }
      }

      if (data.onboardingProgress?.length) {
        const stmt = db.prepare(`
          INSERT INTO onboarding_progress
            (userId, version, status, currentStep, language, starterCollectionId,
             recommendedLessonId, recommendedLessonTitle, nextLessonId, nextLessonTitle,
             startedAt, completedAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(userId) DO UPDATE SET
            version = excluded.version,
            status = excluded.status,
            currentStep = excluded.currentStep,
            language = excluded.language,
            starterCollectionId = excluded.starterCollectionId,
            recommendedLessonId = excluded.recommendedLessonId,
            recommendedLessonTitle = excluded.recommendedLessonTitle,
            nextLessonId = excluded.nextLessonId,
            nextLessonTitle = excluded.nextLessonTitle,
            startedAt = excluded.startedAt,
            completedAt = excluded.completedAt,
            updatedAt = excluded.updatedAt
        `);
        for (const progress of data.onboardingProgress) {
          stmt.run(
            userId,
            progress.version || 1,
            progress.status || 'in_progress',
            progress.currentStep || 'reader',
            progress.language || 'af',
            progress.starterCollectionId || null,
            progress.recommendedLessonId || null,
            progress.recommendedLessonTitle || null,
            progress.nextLessonId || null,
            progress.nextLessonTitle || null,
            progress.startedAt || new Date().toISOString(),
            progress.completedAt || null,
            progress.updatedAt || new Date().toISOString(),
          );
          results.onboardingProgress++;
        }
      }

      if (data.learnerEvents?.length) {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO learner_events
            (userId, id, eventType, language, lessonId, vocabId, properties,
             idempotencyKey, occurredAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const event of data.learnerEvents) {
          const properties =
            typeof event.properties === 'string'
              ? event.properties
              : JSON.stringify(event.properties ?? {});
          stmt.run(
            userId,
            event.id || randomUUID(),
            event.eventType,
            event.language || 'af',
            event.lessonId || null,
            event.vocabId || null,
            properties,
            event.idempotencyKey || null,
            event.occurredAt || new Date().toISOString(),
          );
          results.learnerEvents++;
        }
      }

      if (restoreSettings.length) {
        const stmt = db.prepare(
          'INSERT OR REPLACE INTO settings (userId, key, value) VALUES (?, ?, ?)',
        );
        for (const setting of restoreSettings) {
          stmt.run(userId, setting.key, setting.value);
          results.settings++;
        }
      }
    });

    if (!verdict.allowed) return planLimitResponse(c, verdict);

    return c.json({ success: true, imported: results });
  },
);

export default app;
