import type { PlanLimits } from './entitlements';
import { CACHE_ACCEPTED_LIMITS } from './dictionary-db';
import { KNOWN_SETTING_KEYS, MAX_SETTING_VALUE_BYTES } from './settings-keys';
import { MAX_PERSISTED_ID_BYTES } from './storage-limits';

export const FREE_RESTORE_ENVELOPE_BYTES = 90 * 1024 * 1024;
const JSON_ESCAPE_FACTOR = 2;
const MAX_TIMESTAMP_BYTES = 64;
const MAX_LANGUAGE_CODE_BYTES = 16;
const MAX_FINITE_NUMBER = -Number.MAX_VALUE;
const HOSTILE_ID = '\\'.repeat(MAX_PERSISTED_ID_BYTES);
const HOSTILE_TIMESTAMP = '\\'.repeat(MAX_TIMESTAMP_BYTES);
const HOSTILE_LANGUAGE = '\\'.repeat(MAX_LANGUAGE_CODE_BYTES);

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function requiredLimit(limits: PlanLimits, key: keyof PlanLimits): number {
  const value = limits[key];
  if (value === null) throw new Error(`Free takeout proof requires a finite ${key}`);
  return value;
}

function populatedArrayBytes(count: number, row: unknown): number {
  return count === 0 ? 0 : count * jsonBytes(row) + count - 1;
}

/**
 * Conservative upper bound for JSON.stringify(buildUserExport(freeUser)).
 *
 * Representative rows are actually serialized so field names, quotes,
 * commas, nullable metadata, 128-byte primary/foreign ids, timestamps and all
 * accepted-dictionary child objects are counted. Learner text is accounted
 * separately from the aggregate UTF-8 caps at a 2x JSON escape factor. That
 * factor is valid because takeout removes non-text C0 controls; every remaining
 * UTF-8 byte is emitted once, except quotes/backslashes/newline/tab/CR which
 * can at most double it.
 */
export function calculateFreeTakeoutUpperBound(limits: PlanLimits) {
  const counts = {
    collectionGroups: requiredLimit(limits, 'maxCollectionGroups'),
    collections: requiredLimit(limits, 'maxCollections'),
    lessons: requiredLimit(limits, 'maxLessons'),
    vocab: requiredLimit(limits, 'maxVocabEntries'),
    knownWords: requiredLimit(limits, 'maxKnownWords'),
    clozeSentences: requiredLimit(limits, 'maxClozeSentences'),
    journalEntries: requiredLimit(limits, 'maxJournalEntries'),
    dailyStats: requiredLimit(limits, 'maxDailyStatsRows'),
    acceptedDictionaryEntries: requiredLimit(limits, 'maxAcceptedDictionaryEntries'),
  };

  const baseEnvelope = {
    exportedAt: HOSTILE_TIMESTAMP,
    collections: [],
    collectionGroups: [],
    lessons: [],
    vocab: [],
    knownWords: [],
    clozeSentences: [],
    journalEntries: [],
    dailyStats: [],
    acceptedDictionaryEntries: [],
    settings: [],
  };

  const collectionGroup = {
    id: HOSTILE_ID,
    name: '',
    sortOrder: MAX_FINITE_NUMBER,
    createdAt: HOSTILE_TIMESTAMP,
  };
  const collection = {
    id: HOSTILE_ID,
    title: '',
    author: '',
    coverUrl: '',
    groupId: HOSTILE_ID,
    sortOrder: MAX_FINITE_NUMBER,
    language: HOSTILE_LANGUAGE,
    createdAt: HOSTILE_TIMESTAMP,
    lastReadAt: HOSTILE_TIMESTAMP,
  };
  const lesson = {
    id: HOSTILE_ID,
    collectionId: HOSTILE_ID,
    title: '',
    sortOrder: MAX_FINITE_NUMBER,
    textContent: '',
    progress_scrollPosition: MAX_FINITE_NUMBER,
    progress_percentComplete: MAX_FINITE_NUMBER,
    wordCount: MAX_FINITE_NUMBER,
    language: HOSTILE_LANGUAGE,
    createdAt: HOSTILE_TIMESTAMP,
    lastReadAt: HOSTILE_TIMESTAMP,
  };
  const vocab = {
    id: HOSTILE_ID,
    text: '',
    type: 'phrase',
    sentence: '',
    translation: '',
    state: 'ignored',
    stateUpdatedAt: HOSTILE_TIMESTAMP,
    reviewCount: MAX_FINITE_NUMBER,
    bookId: HOSTILE_ID,
    chapter: MAX_FINITE_NUMBER,
    language: HOSTILE_LANGUAGE,
    createdAt: HOSTILE_TIMESTAMP,
    pushedToAnki: MAX_FINITE_NUMBER,
    ankiNoteId: MAX_FINITE_NUMBER,
  };
  const knownWord = {
    word: '',
    language: HOSTILE_LANGUAGE,
    state: 'ignored',
    domain: 'sport_leisure',
  };
  const clozeSentence = {
    id: HOSTILE_ID,
    sentence: '',
    clozeWord: '',
    clozeIndex: MAX_FINITE_NUMBER,
    translation: '',
    source: 'tatoeba',
    collection: 'top2000',
    wordRank: MAX_FINITE_NUMBER,
    tatoebaSentenceId: MAX_FINITE_NUMBER,
    vocabEntryId: HOSTILE_ID,
    masteryLevel: 100,
    nextReview: HOSTILE_TIMESTAMP,
    reviewCount: MAX_FINITE_NUMBER,
    lastReviewed: HOSTILE_TIMESTAMP,
    timesCorrect: MAX_FINITE_NUMBER,
    timesIncorrect: MAX_FINITE_NUMBER,
    blacklisted: MAX_FINITE_NUMBER,
    language: HOSTILE_LANGUAGE,
  };
  const journalEntry = {
    id: HOSTILE_ID,
    body: '',
    correctedBody: '',
    corrections: '',
    status: 'submitted',
    wordCount: MAX_FINITE_NUMBER,
    entryDate: '9999-12-31',
    language: HOSTILE_LANGUAGE,
    createdAt: HOSTILE_TIMESTAMP,
    updatedAt: HOSTILE_TIMESTAMP,
  };
  const dailyStat = {
    date: '9999-12-31',
    language: HOSTILE_LANGUAGE,
    wordsRead: MAX_FINITE_NUMBER,
    newWordsSaved: MAX_FINITE_NUMBER,
    wordsMarkedKnown: MAX_FINITE_NUMBER,
    minutesRead: MAX_FINITE_NUMBER,
    clozePracticed: MAX_FINITE_NUMBER,
    points: MAX_FINITE_NUMBER,
    dictionaryLookups: MAX_FINITE_NUMBER,
    ankiReviews: MAX_FINITE_NUMBER,
    sessionStartedAt: HOSTILE_TIMESTAMP,
  };
  const acceptedDictionaryEntry = {
    word: '',
    language: HOSTILE_LANGUAGE,
    ipa: '',
    etymology: '',
    sourceSentence: '',
    senses: Array.from({ length: CACHE_ACCEPTED_LIMITS.senses }, () => ({
      partOfSpeech: '',
      gloss: '',
    })),
    relatedForms: Array.from({ length: CACHE_ACCEPTED_LIMITS.relatedForms }, () => ({
      form: '',
      relation: '',
    })),
  };

  const structureAndMetadataBytes =
    jsonBytes(baseEnvelope) +
    populatedArrayBytes(counts.collectionGroups, collectionGroup) +
    populatedArrayBytes(counts.collections, collection) +
    populatedArrayBytes(counts.lessons, lesson) +
    populatedArrayBytes(counts.vocab, vocab) +
    populatedArrayBytes(counts.knownWords, knownWord) +
    populatedArrayBytes(counts.clozeSentences, clozeSentence) +
    populatedArrayBytes(counts.journalEntries, journalEntry) +
    populatedArrayBytes(counts.dailyStats, dailyStat) +
    populatedArrayBytes(counts.acceptedDictionaryEntries, acceptedDictionaryEntry) +
    [...KNOWN_SETTING_KEYS].reduce(
      (total, key, index) => total + jsonBytes({ key, value: '' }) + (index === 0 ? 0 : 1),
      0,
    );

  const learnerTextBytes =
    requiredLimit(limits, 'maxGroupNameBytes') * counts.collectionGroups +
    requiredLimit(limits, 'maxCollectionMetadataBytes') * counts.collections +
    requiredLimit(limits, 'maxLessonTextBytesTotal') +
    requiredLimit(limits, 'maxVocabTextBytesTotal') +
    requiredLimit(limits, 'maxKnownWordsTextBytesTotal') +
    requiredLimit(limits, 'maxClozeTextBytesTotal') +
    requiredLimit(limits, 'maxAcceptedDictionaryBytesTotal') +
    requiredLimit(limits, 'maxJournalTextBytesTotal');
  const escapedLearnerTextBytes = learnerTextBytes * JSON_ESCAPE_FACTOR;
  const escapedSettingValueBytes =
    KNOWN_SETTING_KEYS.size * MAX_SETTING_VALUE_BYTES * JSON_ESCAPE_FACTOR;

  return {
    counts,
    structureAndMetadataBytes,
    escapedLearnerTextBytes,
    escapedSettingValueBytes,
    totalBytes: structureAndMetadataBytes + escapedLearnerTextBytes + escapedSettingValueBytes,
  };
}
