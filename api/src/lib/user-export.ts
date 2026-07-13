/**
 * Portable per-user learning-data export (#225; reused by the admin dashboard
 * #221 to export any account on the operator's behalf). One builder, so the
 * self-service export (GET /api/data) and the admin-triggered export produce
 * byte-identical payloads and can never drift.
 */
import { db, SettingRow } from '../db';
import { sanitizeLegacyCacheAcceptedInput, type CacheAcceptedInput } from './dictionary-db';

export const USER_EXPORT_FORMAT = 'lector-learning-data';
export const USER_EXPORT_VERSION = 1;

export interface UserExport {
  format: typeof USER_EXPORT_FORMAT;
  version: typeof USER_EXPORT_VERSION;
  exportedAt: string;
  collections: unknown[];
  collectionGroups: unknown[];
  lessons: unknown[];
  vocab: unknown[];
  knownWords: unknown[];
  clozeSentences: unknown[];
  journalEntries: unknown[];
  dailyStats: unknown[];
  acceptedDictionaryEntries: CacheAcceptedInput[];
  learnerProfiles: unknown[];
  onboardingProgress: unknown[];
  learnerEvents: unknown[];
  settings: Array<Omit<SettingRow, 'userId'>>;
}

// JSON expands quotes, backslashes and ordinary whitespace escapes by at most
// 2x. Other C0 controls expand to six-byte `\\u00xx` escapes, so remove those
// invisible/non-text bytes from takeouts (including legacy rows) before sizing
// the restore envelope. Ownership is also transport metadata, not learner data.
const NON_PORTABLE_TEXT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

const PORTABLE_SETTING_KEYS = ['targetLanguage', 'timezone'] as const;

function portableValue(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(NON_PORTABLE_TEXT_CONTROLS, '');
  if (Array.isArray(value)) return value.map(portableValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'userId')
      .map(([key, child]) => [key, portableValue(child)]),
  );
}

function portableRows(rows: unknown[]): unknown[] {
  return rows.map(portableValue);
}

/**
 * Portable learning records owned by `userId`, in restore-ready shape. Only
 * language and timezone preferences travel with the data; provider settings,
 * endpoint URLs, credentials, billing state and other operational data do not.
 */
export function buildUserExport(userId: string): UserExport {
  const settings = (
    db
      .prepare('SELECT key, value FROM settings WHERE userId = ? AND key IN (?, ?) ORDER BY key')
      .all(userId, ...PORTABLE_SETTING_KEYS) as SettingRow[]
  ).map(({ key, value }) => ({ key, value: value.replace(NON_PORTABLE_TEXT_CONTROLS, '') }));

  const acceptedDictionaryEntries = (
    db
      .prepare(
        `SELECT word, language, ipa, etymology, sourceSentence
         FROM cached_entries WHERE userId = ? ORDER BY language, word`,
      )
      .all(userId) as Array<{
      word: string;
      language: string;
      ipa: string | null;
      etymology: string | null;
      sourceSentence: string | null;
    }>
  ).flatMap((entry): CacheAcceptedInput[] => {
    const senses = db
      .prepare(
        `SELECT pos, gloss FROM cached_senses
         WHERE userId = ? AND word = ? AND language = ? ORDER BY sort_order`,
      )
      .all(userId, entry.word, entry.language) as Array<{
      pos: string | null;
      gloss: string;
    }>;
    const relatedForms = db
      .prepare(
        `SELECT related_word, relation FROM cached_related_forms
         WHERE userId = ? AND word = ? AND language = ? ORDER BY id`,
      )
      .all(userId, entry.word, entry.language) as Array<{
      related_word: string;
      relation: string;
    }>;
    const restoreSafe = sanitizeLegacyCacheAcceptedInput({
      word: entry.word,
      language: entry.language,
      senses: senses.map((sense) => ({
        partOfSpeech: sense.pos ?? '',
        gloss: sense.gloss,
      })),
      ...(entry.ipa ? { ipa: entry.ipa } : {}),
      ...(entry.etymology ? { etymology: entry.etymology } : {}),
      ...(entry.sourceSentence ? { sourceSentence: entry.sourceSentence } : {}),
      ...(relatedForms.length
        ? {
            relatedForms: relatedForms.map((related) => ({
              form: related.related_word,
              relation: related.relation,
            })),
          }
        : {}),
    });
    return restoreSafe ? [portableValue(restoreSafe) as CacheAcceptedInput] : [];
  });

  return {
    format: USER_EXPORT_FORMAT,
    version: USER_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    collections: portableRows(
      db
        .prepare(
          `SELECT id, title, author, coverUrl, groupId, sortOrder, language, createdAt, lastReadAt
           FROM collections WHERE userId = ?`,
        )
        .all(userId),
    ),
    collectionGroups: portableRows(
      db
        .prepare('SELECT id, name, sortOrder, createdAt FROM collection_groups WHERE userId = ?')
        .all(userId),
    ),
    lessons: portableRows(
      db
        .prepare(
          `SELECT id, collectionId, title, sortOrder, textContent,
                  progress_scrollPosition, progress_percentComplete, wordCount,
                  language, createdAt, lastReadAt
           FROM lessons WHERE userId = ?`,
        )
        .all(userId),
    ),
    vocab: portableRows(
      db
        .prepare(
          `SELECT id, text, type, sentence, translation, state, stateUpdatedAt,
                  reviewCount, bookId, chapter, language, createdAt, pushedToAnki, ankiNoteId
           FROM vocab WHERE userId = ?`,
        )
        .all(userId),
    ),
    knownWords: portableRows(
      db
        .prepare('SELECT word, language, state, domain FROM knownWords WHERE userId = ?')
        .all(userId),
    ),
    clozeSentences: portableRows(
      db
        .prepare(
          `SELECT id, sentence, clozeWord, clozeIndex, translation, source, collection,
                  wordRank, tatoebaSentenceId, vocabEntryId, masteryLevel, nextReview,
                  reviewCount, lastReviewed, timesCorrect, timesIncorrect, blacklisted, language
           FROM clozeSentences WHERE userId = ?`,
        )
        .all(userId),
    ),
    journalEntries: portableRows(
      db
        .prepare(
          `SELECT id, body, correctedBody, corrections, status, wordCount, language,
                  entryDate, createdAt, updatedAt
           FROM journal_entries WHERE userId = ?`,
        )
        .all(userId),
    ),
    dailyStats: portableRows(
      db
        .prepare(
          `SELECT date, language, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead,
                  clozePracticed, points, dictionaryLookups, ankiReviews, sessionStartedAt
           FROM dailyStats WHERE userId = ?`,
        )
        .all(userId),
    ),
    acceptedDictionaryEntries,
    learnerProfiles: portableRows(
      db
        .prepare(
          `SELECT language, approximateLevel, interests, dailyMinutes, createdAt, updatedAt
           FROM learner_profiles WHERE userId = ?`,
        )
        .all(userId),
    ),
    onboardingProgress: portableRows(
      db
        .prepare(
          `SELECT version, status, currentStep, language, starterCollectionId,
                  recommendedLessonId, recommendedLessonTitle, nextLessonId, nextLessonTitle,
                  startedAt, completedAt, updatedAt
           FROM onboarding_progress WHERE userId = ?`,
        )
        .all(userId),
    ),
    learnerEvents: portableRows(
      db
        .prepare(
          `SELECT id, eventType, language, lessonId, vocabId, properties, idempotencyKey, occurredAt
           FROM learner_events WHERE userId = ? ORDER BY occurredAt, rowid`,
        )
        .all(userId),
    ),
    settings,
  };
}
