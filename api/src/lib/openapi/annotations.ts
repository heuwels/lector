/**
 * Hand-written documentation for the Lector REST API.
 *
 * Paths, methods and PAT scopes are NOT here: `endpoints.ts` reads those from
 * the live Hono route table, so they cannot drift. This file holds only the
 * things code cannot state — prose, parameters, and payload shapes.
 *
 * To document a new endpoint, add one entry to `operations`, keyed exactly
 * `"<METHOD> <openapi-path>"` (e.g. `"GET /api/vocab/{id}"`). Run
 * `npm run gen:openapi -- --check` to list keys that are missing or stale.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/** A JSON Schema fragment. Kept loose on purpose — OpenAPI 3.1 takes any valid schema. */
export type JsonSchema = Record<string, unknown>;

export interface QueryParamDoc {
  name: string;
  description: string;
  schema: JsonSchema;
  required?: boolean;
}

export interface RequestBodyDoc {
  description?: string;
  contentType?: string;
  schema: JsonSchema;
  required?: boolean;
}

export interface ResponseDoc {
  description: string;
  schema?: JsonSchema;
  contentType?: string;
}

export interface OperationDoc {
  /** One short line. Shown as the operation title. */
  summary: string;
  /** Optional detail. Markdown is allowed. */
  description?: string;
  /** Docs section this operation belongs to. Must match a `tags` entry. */
  tag: string;
  /** Names of shared parameters in `parameters` below. */
  sharedParams?: string[];
  /** Query parameters unique to this operation. */
  query?: QueryParamDoc[];
  /** Descriptions for the path parameters, keyed by name. */
  pathParams?: Record<string, string>;
  requestBody?: RequestBodyDoc;
  /** Success responses. The generator adds the shared error responses. */
  responses?: Record<string, ResponseDoc>;
  /**
   * Override the derived visibility. The default is `public` when a personal
   * access token can reach the endpoint and `internal` when it cannot.
   */
  visibility?: 'public' | 'internal';
  /** `none` documents an endpoint that needs no credential. Default is `token`. */
  auth?: 'token' | 'none';
  /**
   * Declare a `404`. Set it only when the handler really answers one: a path
   * parameter is no proof, because several handlers upsert or delete an absent
   * row and still answer `200`. A string replaces the default description.
   */
  notFound?: boolean | string;
  deprecated?: boolean;
}

/**
 * The long-form API overview. Kept in Markdown so the repository prose linter
 * (`.claude/skills/proofread`) can check it.
 */
const description = readFileSync(join(import.meta.dir, 'description.md'), 'utf8');

export const info = {
  title: 'Lector API',
  version: '1.0.0',
  description,
  license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
};

export const servers = [
  { url: 'https://app.lector.dev', description: 'Lector Cloud' },
  { url: 'http://localhost:3457', description: 'Self-hosted API (default port)' },
];

export const tags = [
  { name: 'Library', description: 'Collections, groups and lessons.' },
  { name: 'Import', description: 'Bring text, EPUB, audio and video into the library.' },
  { name: 'Vocabulary', description: 'Saved words and phrases, and word knowledge states.' },
  { name: 'Practice', description: 'Cloze practice cards and their review schedule.' },
  { name: 'Dictionary', description: 'Word lookup and the accepted-translation cache.' },
  { name: 'Language help', description: 'Machine translation, explanation and speech.' },
  { name: 'Journal', description: 'Written entries and their corrections.' },
  { name: 'Statistics', description: 'Daily activity, streaks and fluency estimates.' },
  { name: 'Anki', description: 'Card queue and review sync for the Anki add-on.' },
  { name: 'Settings', description: 'Account preferences and provider configuration.' },
  { name: 'Data', description: 'Export and restore the account’s learning data.' },
  { name: 'Chat', description: 'Conversation practice with the language model.' },
  { name: 'Onboarding', description: 'Guided first-run state and starter content.' },
  { name: 'Service', description: 'Health and deployment information.' },
];

/** Reusable parameters. `sharedParams` entries name one of these. */
export const parameters: Record<string, JsonSchema> = {
  LanguageQuery: {
    name: 'language',
    in: 'query',
    required: false,
    description: 'Language pack code. Defaults to the account’s active language.',
    schema: { type: 'string', examples: ['af', 'es', 'grc'] },
  },
};

const ISO_DATE_TIME: JsonSchema = { type: 'string', format: 'date-time' };
const ISO_DATE: JsonSchema = { type: 'string', description: 'Calendar date, `YYYY-MM-DD`.' };
const NULLABLE_STRING: JsonSchema = { type: ['string', 'null'] };

const WORD_STATE: JsonSchema = {
  type: 'string',
  enum: ['new', 'level1', 'level2', 'level3', 'level4', 'known', 'ignored'],
  description:
    'How well the account knows a word. `level1` to `level4` are the learning steps between `new` and `known`. `ignored` hides the word.',
};

/** Reusable schemas. Referenced from operations as `{ $ref: '#/components/schemas/<name>' }`. */
export const schemas: Record<string, JsonSchema> = {
  Error: {
    type: 'object',
    properties: { error: { type: 'string', description: 'What went wrong.' } },
    required: ['error'],
  },

  PlanLimitError: {
    type: 'object',
    description: 'A plan limit stopped the call.',
    properties: {
      error: { type: 'string' },
      limit: { type: 'string', description: 'Name of the limit that was reached.' },
      plan: { type: 'string' },
    },
    required: ['error'],
  },

  Success: {
    type: 'object',
    properties: { success: { type: 'boolean', enum: [true] } },
    required: ['success'],
  },

  CreatedId: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Identifier of the new record.' } },
    required: ['id'],
  },

  IdList: {
    type: 'object',
    description: 'Records in their new order. `sortOrder` becomes the array index.',
    properties: { ids: { type: 'array', items: { type: 'string' } } },
    required: ['ids'],
  },

  Collection: {
    type: 'object',
    description:
      'A book, course or folder of lessons in one language. These are the stored fields, and the data takeout carries exactly these.',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      author: { type: 'string' },
      coverUrl: NULLABLE_STRING,
      groupId: { ...NULLABLE_STRING, description: 'Group that holds the collection.' },
      language: { type: 'string' },
      sortOrder: { type: 'integer' },
      createdAt: ISO_DATE_TIME,
      lastReadAt: ISO_DATE_TIME,
    },
    required: ['id', 'title', 'author', 'sortOrder', 'createdAt', 'lastReadAt'],
  },

  CollectionListItem: {
    allOf: [
      { $ref: '#/components/schemas/Collection' },
      {
        type: 'object',
        description: 'The list adds the group name and the lesson totals.',
        properties: {
          groupName: { ...NULLABLE_STRING, description: 'Name of the group that holds it.' },
          lessonCount: { type: 'integer' },
          avgProgress: {
            type: 'number',
            description: 'Mean reading progress over its lessons, from 0 to 100.',
          },
        },
      },
    ],
  },

  CollectionDetail: {
    allOf: [
      { $ref: '#/components/schemas/Collection' },
      {
        type: 'object',
        description: 'The single-collection read adds the lesson totals.',
        properties: {
          lessonCount: { type: 'integer' },
          avgProgress: {
            type: 'number',
            description: 'Mean reading progress over its lessons, from 0 to 100.',
          },
        },
      },
    ],
  },

  CollectionGroup: {
    type: 'object',
    description: 'A container for collections. Groups hold every language.',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      sortOrder: { type: 'integer' },
      collectionCount: {
        type: 'integer',
        description: 'Collections in the group, counted across every language.',
      },
      createdAt: ISO_DATE_TIME,
    },
    required: ['id', 'name', 'sortOrder', 'createdAt'],
  },

  Lesson: {
    type: 'object',
    description: 'One readable text, and its audio when the source carried audio.',
    properties: {
      id: { type: 'string' },
      collectionId: NULLABLE_STRING,
      title: { type: 'string' },
      sortOrder: { type: 'integer' },
      textContent: { type: 'string', description: 'The lesson text, as Markdown.' },
      wordCount: { type: 'integer' },
      language: { type: 'string' },
      progress_scrollPosition: { type: 'number' },
      progress_percentComplete: { type: 'number', minimum: 0, maximum: 100 },
      sourceType: {
        ...NULLABLE_STRING,
        description: 'Origin of the text, for example `youtube`. Null for plain Markdown.',
      },
      sourceMeta: { ...NULLABLE_STRING, description: 'Origin metadata, as a JSON string.' },
      segmentWords: {
        ...NULLABLE_STRING,
        description:
          'The distinct word forms a segmenter found, as a JSON string array. Null for every spaced language.',
      },
      audioDurationMs: { type: ['integer', 'null'] },
      audioBytes: { type: ['integer', 'null'] },
      transcriptionStatus: {
        type: ['string', 'null'],
        enum: ['pending', 'processing', 'done', 'error', null],
        description: 'Transcription state of an audio lesson. Null for a text lesson.',
      },
      transcriptionError: NULLABLE_STRING,
      transcriptionAttempts: { type: 'integer' },
      createdAt: ISO_DATE_TIME,
      lastReadAt: ISO_DATE_TIME,
    },
    required: ['id', 'title', 'sortOrder', 'textContent', 'wordCount', 'createdAt'],
  },

  LessonListItem: {
    type: 'object',
    description:
      'A lesson as the collection listing returns it. The text stays out, so fetch the lesson itself to read it.',
    properties: {
      id: { type: 'string' },
      collectionId: NULLABLE_STRING,
      title: { type: 'string' },
      sortOrder: { type: 'integer' },
      wordCount: { type: 'integer' },
      progress_scrollPosition: { type: 'number' },
      progress_percentComplete: { type: 'number', minimum: 0, maximum: 100 },
      audioDurationMs: { type: ['integer', 'null'] },
      transcriptionStatus: {
        type: ['string', 'null'],
        enum: ['pending', 'processing', 'done', 'error', null],
      },
      transcriptionError: NULLABLE_STRING,
      createdAt: ISO_DATE_TIME,
      lastReadAt: ISO_DATE_TIME,
    },
    required: ['id', 'title', 'sortOrder', 'wordCount', 'createdAt'],
  },

  TranscriptSegment: {
    type: 'object',
    description: 'One timed line of an audio transcript.',
    properties: {
      idx: { type: 'integer', description: 'Position in playback order.' },
      startMs: { type: 'integer' },
      endMs: { type: 'integer' },
      text: { type: 'string' },
    },
    required: ['idx', 'startMs', 'endMs', 'text'],
  },

  VocabEntry: {
    type: 'object',
    description: 'A word or phrase the account saved, with the sentence it came from.',
    properties: {
      id: { type: 'string' },
      text: { type: 'string' },
      type: { type: 'string', enum: ['word', 'phrase'] },
      sentence: { type: 'string', description: 'Sentence that held the word.' },
      translation: { type: 'string' },
      state: WORD_STATE,
      stateUpdatedAt: ISO_DATE_TIME,
      reviewCount: { type: 'integer' },
      bookId: { ...NULLABLE_STRING, description: 'Collection the word came from.' },
      chapter: { type: ['integer', 'null'] },
      language: { type: 'string' },
      pushedToAnki: { type: 'integer', enum: [0, 1] },
      ankiNoteId: { type: ['integer', 'null'] },
      createdAt: ISO_DATE_TIME,
    },
    required: ['id', 'text', 'type', 'state', 'language', 'createdAt'],
  },

  KnownWordMap: {
    type: 'object',
    description: 'Every rated word in the language, as a word to state map.',
    additionalProperties: WORD_STATE,
  },

  ClozeCard: {
    type: 'object',
    description: 'A practice sentence with one word blanked out, plus its review schedule.',
    properties: {
      id: { type: 'string' },
      sentence: { type: 'string' },
      clozeWord: { type: 'string', description: 'The word the learner must supply.' },
      clozeIndex: {
        type: 'integer',
        description: 'Position of the blanked word in the sentence, counted in words.',
      },
      translation: { type: 'string' },
      language: { type: 'string' },
      source: { type: 'string', enum: ['tatoeba', 'mined'] },
      collection: { type: 'string', enum: ['top500', 'top1000', 'top2000', 'mined', 'random'] },
      wordRank: { type: ['integer', 'null'], description: 'Frequency rank of the blanked word.' },
      tatoebaSentenceId: { type: ['integer', 'null'] },
      vocabEntryId: {
        ...NULLABLE_STRING,
        description: 'Vocabulary entry the card was mined from.',
      },
      masteryLevel: { type: 'integer', enum: [0, 25, 50, 75, 100] },
      nextReview: ISO_DATE_TIME,
      lastReviewed: { type: ['string', 'null'], format: 'date-time' },
      reviewCount: { type: 'integer' },
      timesCorrect: { type: 'integer' },
      timesIncorrect: { type: 'integer' },
      blacklisted: { type: 'integer', enum: [0, 1], description: '1 hides the card.' },
    },
    required: ['id', 'sentence', 'clozeWord', 'clozeIndex', 'masteryLevel', 'nextReview'],
  },

  DailyStats: {
    type: 'object',
    description: 'One day of activity in one language.',
    properties: {
      date: ISO_DATE,
      language: { type: 'string' },
      wordsRead: { type: 'integer' },
      newWordsSaved: { type: 'integer' },
      wordsMarkedKnown: { type: 'integer' },
      minutesRead: { type: 'integer' },
      clozePracticed: { type: 'integer' },
      points: { type: 'integer' },
      dictionaryLookups: { type: 'integer' },
      ankiReviews: { type: 'integer' },
      sessionStartedAt: { type: ['string', 'null'], format: 'date-time' },
    },
    required: ['date'],
  },

  Correction: {
    type: 'object',
    description: 'One correction that the language model made to a journal entry.',
    properties: {
      original: { type: 'string', description: 'The wrong word or phrase.' },
      corrected: { type: 'string' },
      explanation: { type: 'string', description: 'Why the original is wrong.' },
      type: {
        type: 'string',
        enum: ['grammar', 'spelling', 'word_choice', 'word_order', 'missing_word', 'extra_word'],
      },
    },
  },

  JournalEntry: {
    type: 'object',
    description: 'A piece of writing in the target language, and its correction.',
    properties: {
      id: { type: 'string' },
      body: { type: 'string' },
      correctedBody: NULLABLE_STRING,
      corrections: {
        type: ['array', 'null'],
        description: 'The corrections. Null before a correction runs.',
        items: { $ref: '#/components/schemas/Correction' },
      },
      status: { type: 'string', enum: ['draft', 'submitted'] },
      wordCount: { type: 'integer' },
      language: { type: 'string' },
      entryDate: ISO_DATE,
      createdAt: ISO_DATE_TIME,
      updatedAt: ISO_DATE_TIME,
    },
    required: ['id', 'body', 'status', 'wordCount', 'language', 'entryDate'],
  },

  DictionaryEntry: {
    type: 'object',
    description: 'A dictionary result for one word.',
    properties: {
      word: { type: 'string' },
      rank: { type: 'integer', description: 'Frequency rank in the language.' },
      ipa: { type: 'string' },
      etymology: { type: 'string' },
      senses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            partOfSpeech: { type: 'string' },
            gloss: { type: 'string' },
          },
          required: ['partOfSpeech', 'gloss'],
        },
      },
      relatedForms: {
        type: 'array',
        items: {
          type: 'object',
          properties: { form: { type: 'string' }, relation: { type: 'string' } },
          required: ['form', 'relation'],
        },
      },
      lemmaInfo: {
        type: 'object',
        description: 'Set when the lookup matched an inflected form.',
        properties: { stem: { type: 'string' }, label: { type: 'string' } },
      },
      source: {
        type: 'string',
        enum: ['dict', 'cache'],
        description: '`dict` is the built-in dictionary. `cache` is a translation you accepted.',
      },
    },
    required: ['word', 'senses'],
  },

  OnboardingSnapshot: {
    type: 'object',
    description: 'The guided first-run state of the account.',
    properties: {
      progress: {
        type: ['object', 'null'],
        description: 'Null before the account starts or skips the guided first run.',
        properties: {
          version: { type: 'integer' },
          status: { type: 'string', enum: ['in_progress', 'completed', 'skipped'] },
          currentStep: { type: 'string', enum: ['reader', 'practice', 'summary'] },
          language: { type: 'string' },
          starterCollectionId: NULLABLE_STRING,
          recommendedLessonId: NULLABLE_STRING,
          recommendedLessonTitle: NULLABLE_STRING,
          nextLessonId: NULLABLE_STRING,
          nextLessonTitle: NULLABLE_STRING,
          startedAt: ISO_DATE_TIME,
          completedAt: { type: ['string', 'null'], format: 'date-time' },
          updatedAt: ISO_DATE_TIME,
        },
      },
      profile: {
        type: ['object', 'null'],
        properties: {
          language: { type: 'string' },
          approximateLevel: {
            type: 'string',
            enum: ['new', 'beginner', 'intermediate', 'advanced', 'not_sure'],
          },
          interests: { type: 'array', items: { type: 'string' } },
          dailyMinutes: { type: 'integer' },
          createdAt: ISO_DATE_TIME,
          updatedAt: ISO_DATE_TIME,
        },
      },
      events: {
        type: 'array',
        description: 'The learner events since the guided first run started.',
        items: { $ref: '#/components/schemas/LearnerEvent' },
      },
    },
  },

  LearnerEvent: {
    type: 'object',
    description: 'One recorded product analytics event.',
    properties: {
      id: { type: 'string' },
      eventType: { type: 'string' },
      language: { type: 'string' },
      lessonId: NULLABLE_STRING,
      vocabId: NULLABLE_STRING,
      properties: { type: 'object' },
      idempotencyKey: NULLABLE_STRING,
      occurredAt: ISO_DATE_TIME,
    },
  },

  LessonExport: {
    type: 'object',
    description:
      'A lesson as the data takeout carries it. The text travels, and the audio and transcription state stay behind.',
    properties: {
      id: { type: 'string' },
      collectionId: NULLABLE_STRING,
      title: { type: 'string' },
      sortOrder: { type: 'integer' },
      textContent: { type: 'string', description: 'The lesson text, as Markdown.' },
      wordCount: { type: 'integer' },
      language: { type: 'string' },
      progress_scrollPosition: { type: 'number' },
      progress_percentComplete: { type: 'number', minimum: 0, maximum: 100 },
      createdAt: ISO_DATE_TIME,
      lastReadAt: ISO_DATE_TIME,
    },
    required: ['id', 'title', 'sortOrder', 'textContent', 'wordCount', 'createdAt'],
  },

  JournalEntryExport: {
    type: 'object',
    description:
      'A journal entry as the data takeout carries it. `corrections` stays a JSON string here, while the journal endpoints parse it.',
    properties: {
      id: { type: 'string' },
      body: { type: 'string' },
      correctedBody: NULLABLE_STRING,
      corrections: {
        ...NULLABLE_STRING,
        description: 'The corrections, as a JSON string.',
      },
      status: { type: 'string', enum: ['draft', 'submitted'] },
      wordCount: { type: 'integer' },
      language: { type: 'string' },
      entryDate: ISO_DATE,
      createdAt: ISO_DATE_TIME,
      updatedAt: ISO_DATE_TIME,
    },
    required: ['id', 'body', 'status', 'wordCount', 'language', 'entryDate'],
  },

  UserExport: {
    type: 'object',
    description: 'Every portable learning record for the account.',
    properties: {
      format: { type: 'string', enum: ['lector-learning-data'] },
      version: { type: 'integer', enum: [1] },
      exportedAt: ISO_DATE_TIME,
      collections: { type: 'array', items: { $ref: '#/components/schemas/Collection' } },
      collectionGroups: { type: 'array', items: { $ref: '#/components/schemas/CollectionGroup' } },
      lessons: { type: 'array', items: { $ref: '#/components/schemas/LessonExport' } },
      vocab: { type: 'array', items: { $ref: '#/components/schemas/VocabEntry' } },
      knownWords: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            word: { type: 'string' },
            language: { type: 'string' },
            state: WORD_STATE,
            domain: { ...NULLABLE_STRING, description: 'Topic the classifier assigned.' },
          },
        },
      },
      clozeSentences: { type: 'array', items: { $ref: '#/components/schemas/ClozeCard' } },
      journalEntries: {
        type: 'array',
        items: { $ref: '#/components/schemas/JournalEntryExport' },
      },
      dailyStats: { type: 'array', items: { $ref: '#/components/schemas/DailyStats' } },
      acceptedDictionaryEntries: { type: 'array', items: { type: 'object' } },
      learnerProfiles: { type: 'array', items: { type: 'object' } },
      onboardingProgress: { type: 'array', items: { type: 'object' } },
      learnerEvents: { type: 'array', items: { type: 'object' } },
      settings: {
        type: 'array',
        description:
          'Only the portable preferences: `enabledLanguages`, `targetLanguage` and `timezone`.',
        items: {
          type: 'object',
          properties: { key: { type: 'string' }, value: { type: 'string' } },
        },
      },
    },
    required: ['format', 'version', 'exportedAt'],
  },
};

const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (name: string): JsonSchema => ({ type: 'array', items: ref(name) });
const LANG = ['LanguageQuery'];

/**
 * Documentation for each operation, keyed `"<METHOD> <path>"`.
 *
 * A key that no route serves, and a route that no key documents, are both
 * reported by `gen-openapi.ts --check`.
 */
const libraryOps: Record<string, OperationDoc> = {
  // ── Library: collections ───────────────────────────────────────────────────
  'GET /api/collections': {
    summary: 'List collections',
    description: 'Collections in the language, in sort order.',
    tag: 'Library',
    sharedParams: LANG,
    responses: {
      '200': {
        description: 'The account’s collections.',
        schema: arrayOf('CollectionListItem'),
      },
    },
  },
  'POST /api/collections': {
    summary: 'Create a collection',
    tag: 'Library',
    requestBody: {
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          author: { type: 'string' },
          coverUrl: NULLABLE_STRING,
          groupId: NULLABLE_STRING,
          language: { type: 'string' },
          id: { type: 'string', description: 'Supply your own identifier. Optional.' },
        },
        required: ['title'],
      },
      required: true,
    },
    responses: { '200': { description: 'The new collection.', schema: ref('CreatedId') } },
  },
  'PUT /api/collections/reorder': {
    summary: 'Reorder collections',
    description: 'Send the collections of one group in their new order.',
    tag: 'Library',
    requestBody: { schema: ref('IdList'), required: true },
    responses: { '200': { description: 'The new order is stored.', schema: ref('Success') } },
  },
  'GET /api/collections/{id}': {
    notFound: true,
    summary: 'Get a collection',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Collection identifier.' },
    responses: { '200': { description: 'The collection.', schema: ref('CollectionDetail') } },
  },
  'PUT /api/collections/{id}': {
    summary: 'Update a collection',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Collection identifier.' },
    requestBody: {
      schema: {
        type: 'object',
        description: 'Send only the fields to change.',
        properties: {
          title: { type: 'string' },
          author: { type: 'string' },
          coverUrl: NULLABLE_STRING,
          groupId: NULLABLE_STRING,
        },
      },
      required: true,
    },
    responses: { '200': { description: 'The collection is updated.', schema: ref('Success') } },
  },
  'DELETE /api/collections/{id}': {
    summary: 'Delete a collection',
    description: 'Deletes the collection, its lessons, and any audio on disk.',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Collection identifier.' },
    responses: { '200': { description: 'The collection is deleted.', schema: ref('Success') } },
  },
  'GET /api/collections/{id}/lessons': {
    summary: 'List the lessons of a collection',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Collection identifier.' },
    responses: {
      '200': { description: 'Lessons in sort order.', schema: arrayOf('LessonListItem') },
    },
  },
  'POST /api/collections/{id}/lessons': {
    notFound: 'No such collection, in this account and language.',
    summary: 'Add a lesson to a collection',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Collection identifier.' },
    requestBody: {
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          textContent: { type: 'string', description: 'Lesson text, as Markdown.' },
          sortOrder: { type: 'integer' },
          id: { type: 'string', description: 'Supply your own identifier. Optional.' },
        },
        required: ['title', 'textContent'],
      },
      required: true,
    },
    responses: { '200': { description: 'The new lesson.', schema: ref('CreatedId') } },
  },
  'PUT /api/collections/{id}/lessons/reorder': {
    summary: 'Reorder the lessons of a collection',
    tag: 'Library',
    pathParams: { id: 'Collection identifier.' },
    requestBody: { schema: ref('IdList'), required: true },
    responses: { '200': { description: 'The new order is stored.', schema: ref('Success') } },
  },

  // ── Library: groups ───────────────────────────────────────────────────────
  'GET /api/groups': {
    summary: 'List collection groups',
    description: 'Groups hold collections of every language, so the count crosses languages.',
    tag: 'Library',
    responses: {
      '200': { description: 'Groups in sort order.', schema: arrayOf('CollectionGroup') },
    },
  },
  'POST /api/groups': {
    summary: 'Create a group',
    tag: 'Library',
    requestBody: {
      schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      required: true,
    },
    responses: { '200': { description: 'The new group.', schema: ref('CreatedId') } },
  },
  'PUT /api/groups/{id}': {
    summary: 'Rename or reorder a group',
    tag: 'Library',
    pathParams: { id: 'Group identifier.' },
    requestBody: {
      schema: {
        type: 'object',
        properties: { name: { type: 'string' }, sortOrder: { type: 'integer' } },
      },
      required: true,
    },
    responses: { '200': { description: 'The group is updated.', schema: ref('Success') } },
  },
  'DELETE /api/groups/{id}': {
    summary: 'Delete a group',
    description: 'The collections survive. They become ungrouped.',
    tag: 'Library',
    pathParams: { id: 'Group identifier.' },
    responses: { '200': { description: 'The group is deleted.', schema: ref('Success') } },
  },

  // ── Library: lessons ──────────────────────────────────────────────────────
  'GET /api/lessons/{id}': {
    notFound: true,
    summary: 'Get a lesson',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Lesson identifier.' },
    responses: { '200': { description: 'The lesson.', schema: ref('Lesson') } },
  },
  'PUT /api/lessons/{id}': {
    summary: 'Update a lesson',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Lesson identifier.' },
    requestBody: {
      schema: {
        type: 'object',
        description: 'Send only the fields to change.',
        properties: {
          title: { type: 'string' },
          textContent: { type: 'string' },
          collectionId: NULLABLE_STRING,
          sortOrder: { type: 'integer' },
        },
      },
      required: true,
    },
    responses: { '200': { description: 'The lesson is updated.', schema: ref('Success') } },
  },
  'DELETE /api/lessons/{id}': {
    summary: 'Delete a lesson',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Lesson identifier.' },
    responses: { '200': { description: 'The lesson is deleted.', schema: ref('Success') } },
  },
  'PUT /api/lessons/{id}/progress': {
    notFound: true,
    summary: 'Store reading progress',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Lesson identifier.' },
    requestBody: {
      schema: {
        type: 'object',
        properties: {
          scrollPosition: { type: 'number' },
          percentComplete: { type: 'number', minimum: 0, maximum: 100 },
        },
      },
      required: true,
    },
    responses: { '200': { description: 'The progress is stored.', schema: ref('Success') } },
  },
  'GET /api/lessons/{id}/segments': {
    notFound: true,
    summary: 'Get the timed transcript of a lesson',
    description:
      'Returns the audio-timed lines for listen-along. The array is empty until transcription finishes, and for text lessons.',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Lesson identifier.' },
    responses: {
      '200': { description: 'Segments in playback order.', schema: arrayOf('TranscriptSegment') },
    },
  },
  'GET /api/lessons/{id}/readings': {
    notFound: true,
    summary: 'Get the pronunciation of every word in a lesson',
    description:
      'Returns one reading per word for the reader annotation layer: pinyin for Chinese, and a rule-derived transcription for Esperanto. The keys are the folded word forms the reader looks words up by. The object is empty for a language that declares no annotation source, and a word the dictionary has no reading for is absent.',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Lesson identifier.' },
    responses: {
      '200': {
        description: 'Folded word to reading.',
        schema: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
  },
  'GET /api/lessons/{id}/audio': {
    notFound: 'The lesson has no audio, or the stored file is gone.',
    summary: 'Stream the audio of a lesson',
    description:
      'Serves the audio file. The endpoint honours the `Range` header and answers `206` with `Content-Range`, so a player can seek.',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Lesson identifier.' },
    responses: {
      '200': {
        description: 'The complete audio file.',
        contentType: 'audio/*',
        schema: { type: 'string', format: 'binary' },
      },
      '206': {
        description: 'The requested byte range.',
        contentType: 'audio/*',
        schema: { type: 'string', format: 'binary' },
      },
    },
  },
  'POST /api/lessons/{id}/retry-transcription': {
    notFound: 'No such lesson, or its transcription did not fail.',
    summary: 'Retry a failed transcription',
    description: 'Puts a failed audio lesson back in the transcription queue.',
    tag: 'Library',
    sharedParams: LANG,
    pathParams: { id: 'Lesson identifier.' },
    responses: { '200': { description: 'The lesson is queued again.', schema: ref('Success') } },
  },
};

const importOps: Record<string, OperationDoc> = {
  'POST /api/import/epub': {
    summary: 'Import an EPUB',
    description: 'Creates one collection, and one lesson per chapter.',
    tag: 'Import',
    requestBody: {
      contentType: 'multipart/form-data',
      required: true,
      schema: {
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary', description: 'The EPUB file.' },
          language: { type: 'string' },
          groupId: { type: 'string', description: 'Put the new collection in this group.' },
        },
        required: ['file'],
      },
    },
    responses: {
      '200': {
        description: 'The import finished.',
        schema: {
          type: 'object',
          properties: {
            collectionId: { type: 'string' },
            title: { type: 'string' },
            author: { type: 'string' },
            lessonCount: { type: 'integer' },
          },
        },
      },
    },
  },
  'POST /api/import/audio': {
    summary: 'Import an audio file',
    description:
      'Stores the audio and creates a pending lesson. A background worker writes the transcript, so poll the lesson for `transcriptionStatus`.',
    tag: 'Import',
    requestBody: {
      contentType: 'multipart/form-data',
      required: true,
      schema: {
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary', description: 'The audio file.' },
          title: { type: 'string' },
          language: { type: 'string' },
          groupId: { type: 'string' },
        },
        required: ['file'],
      },
    },
    responses: {
      '200': {
        description: 'The audio is stored and the transcript is queued.',
        schema: {
          type: 'object',
          properties: {
            collectionId: { type: 'string' },
            lessonId: { type: 'string' },
            title: { type: 'string' },
            audioDurationMs: { type: ['integer', 'null'] },
            transcriptionStatus: { type: 'string', enum: ['pending'] },
          },
        },
      },
    },
  },
  'POST /api/import/youtube/resolve': {
    summary: 'List the caption tracks of a video',
    description: 'Reads the video metadata and its caption tracks. Stores nothing.',
    tag: 'Import',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'A YouTube watch URL.' } },
        required: ['url'],
      },
    },
    responses: {
      '200': {
        description: 'Video metadata and the available tracks.',
        schema: { type: 'object' },
      },
    },
  },
  'POST /api/import/youtube': {
    summary: 'Import a caption track as a lesson',
    tag: 'Import',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          trackId: { type: 'string', description: 'A track from the resolve call.' },
          language: { type: 'string' },
          groupId: { type: 'string' },
        },
        required: ['url'],
      },
    },
    responses: { '200': { description: 'The lesson is created.', schema: { type: 'object' } } },
  },
  'POST /api/extract-url': {
    summary: 'Extract an article from a URL',
    description: 'Fetches the page and returns its readable article as Markdown. Stores nothing.',
    tag: 'Import',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
    responses: {
      '200': {
        description: 'The extracted article.',
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            author: NULLABLE_STRING,
            content: { type: 'string', description: 'The article, as Markdown.' },
            siteName: { type: 'string' },
            excerpt: NULLABLE_STRING,
            wordCount: { type: 'integer' },
          },
        },
      },
      '400': {
        description: 'The URL is not valid, or the page is too large.',
        schema: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string', enum: ['INVALID_URL', 'FETCH_FAILED', 'EXTRACTION_FAILED'] },
          },
        },
      },
    },
  },
};

const vocabOps: Record<string, OperationDoc> = {
  'GET /api/vocab': {
    summary: 'List saved words and phrases',
    tag: 'Vocabulary',
    sharedParams: LANG,
    query: [
      { name: 'state', description: 'Return only entries in this state.', schema: WORD_STATE },
      {
        name: 'bookId',
        description: 'Return only entries from this collection.',
        schema: { type: 'string' },
      },
      {
        name: 'unpushed',
        description: 'Set to `true` to return only entries that Anki does not hold yet.',
        schema: { type: 'string', enum: ['true'] },
      },
      {
        name: 'text',
        description: 'Return only the entry with this exact text. Fold the word first.',
        schema: { type: 'string' },
      },
    ],
    responses: { '200': { description: 'Matching entries.', schema: arrayOf('VocabEntry') } },
  },
  'POST /api/vocab': {
    summary: 'Save a word or phrase',
    tag: 'Vocabulary',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: ['word', 'phrase'] },
          sentence: { type: 'string' },
          translation: { type: 'string' },
          state: WORD_STATE,
          bookId: NULLABLE_STRING,
          chapter: { type: ['integer', 'null'] },
          language: { type: 'string' },
          id: { type: 'string', description: 'Supply your own identifier. Optional.' },
        },
        required: ['text'],
      },
    },
    responses: { '200': { description: 'The new entry.', schema: ref('CreatedId') } },
  },
  'GET /api/vocab/{id}': {
    notFound: true,
    summary: 'Get one saved entry',
    tag: 'Vocabulary',
    sharedParams: LANG,
    pathParams: { id: 'Vocabulary entry identifier.' },
    responses: { '200': { description: 'The entry.', schema: ref('VocabEntry') } },
  },
  'PUT /api/vocab/{id}': {
    notFound: true,
    summary: 'Update a saved entry',
    tag: 'Vocabulary',
    sharedParams: LANG,
    pathParams: { id: 'Vocabulary entry identifier.' },
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        description: 'Send only the fields to change.',
        properties: {
          text: { type: 'string' },
          sentence: { type: 'string' },
          translation: { type: 'string' },
          state: WORD_STATE,
          reviewCount: { type: 'integer' },
          pushedToAnki: { type: 'integer', enum: [0, 1] },
          ankiNoteId: { type: ['integer', 'null'] },
        },
      },
    },
    responses: { '200': { description: 'The entry is updated.', schema: ref('Success') } },
  },
  'DELETE /api/vocab/{id}': {
    notFound: true,
    summary: 'Delete a saved entry',
    tag: 'Vocabulary',
    sharedParams: LANG,
    pathParams: { id: 'Vocabulary entry identifier.' },
    responses: { '200': { description: 'The entry is deleted.', schema: ref('Success') } },
  },
  'GET /api/known-words': {
    summary: 'Get every word knowledge state',
    description: 'Returns one map for the language. The reader colours words from it.',
    tag: 'Vocabulary',
    sharedParams: LANG,
    responses: { '200': { description: 'Word to state map.', schema: ref('KnownWordMap') } },
  },
  'POST /api/known-words': {
    summary: 'Update word knowledge states in bulk',
    tag: 'Vocabulary',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          language: { type: 'string' },
          updates: {
            type: 'array',
            items: {
              type: 'object',
              properties: { word: { type: 'string' }, state: WORD_STATE },
              required: ['word', 'state'],
            },
          },
        },
        required: ['updates'],
      },
    },
    responses: {
      '200': {
        description: 'The states are stored.',
        schema: {
          type: 'object',
          properties: { success: { type: 'boolean' }, count: { type: 'integer' } },
        },
      },
    },
  },
};

const CLOZE_CREATE_ITEM: JsonSchema = {
  type: 'object',
  properties: {
    sentence: { type: 'string' },
    clozeWord: { type: 'string' },
    clozeIndex: { type: 'integer' },
    translation: { type: 'string' },
    source: { type: 'string', enum: ['tatoeba', 'mined'] },
    collection: { type: 'string', enum: ['top500', 'top1000', 'top2000', 'mined', 'random'] },
    wordRank: { type: ['integer', 'null'] },
    tatoebaSentenceId: { type: ['integer', 'null'] },
    vocabEntryId: NULLABLE_STRING,
    masteryLevel: { type: 'integer', enum: [0, 25, 50, 75, 100] },
    nextReview: ISO_DATE_TIME,
    language: { type: 'string' },
    id: { type: 'string', description: 'Supply your own identifier. Optional.' },
  },
  required: ['sentence', 'clozeWord', 'translation'],
};

const practiceOps: Record<string, OperationDoc> = {
  'GET /api/cloze': {
    summary: 'List practice cards',
    description: 'Cards in the language, soonest review first. Hidden cards stay out.',
    tag: 'Practice',
    sharedParams: LANG,
    query: [
      {
        name: 'collection',
        description: 'Return only cards from this bank.',
        schema: { type: 'string', enum: ['top500', 'top1000', 'top2000', 'mined', 'random'] },
      },
      {
        name: 'word',
        description: 'Return only cards that blank this exact word.',
        schema: { type: 'string' },
      },
      {
        name: 'limit',
        description: 'Maximum cards to return. The default is 100.',
        schema: { type: 'integer' },
      },
    ],
    responses: { '200': { description: 'Matching cards.', schema: arrayOf('ClozeCard') } },
  },
  'POST /api/cloze': {
    summary: 'Create or replace practice cards',
    description:
      'Send one object, or an array for a batch. Every card in a batch must use one language. A card with an existing identifier is replaced.',
    tag: 'Practice',
    requestBody: {
      required: true,
      schema: { oneOf: [CLOZE_CREATE_ITEM, { type: 'array', items: CLOZE_CREATE_ITEM }] },
    },
    responses: {
      '200': {
        description:
          'One object answers with the new identifier. An array answers with the stored count.',
        schema: {
          oneOf: [
            ref('CreatedId'),
            {
              type: 'object',
              properties: { success: { type: 'boolean' }, count: { type: 'integer' } },
            },
          ],
        },
      },
    },
  },
  'GET /api/cloze/due': {
    summary: 'Get the cards due for practice',
    tag: 'Practice',
    sharedParams: LANG,
    query: [
      {
        name: 'limit',
        description: 'Maximum cards to return. The default is 20.',
        schema: { type: 'integer' },
      },
      {
        name: 'mode',
        description:
          '`new` returns cards with no review yet. `review` returns seen cards that are due. Omit it for both.',
        schema: { type: 'string', enum: ['new', 'review'] },
      },
      {
        name: 'collection',
        description: 'Return only cards from this bank.',
        schema: { type: 'string', enum: ['top500', 'top1000', 'top2000', 'mined', 'random'] },
      },
      {
        name: 'excludeWords',
        description: 'Comma-separated words to leave out of the round.',
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': { description: 'Cards to practise, in random order.', schema: arrayOf('ClozeCard') },
    },
  },
  'GET /api/cloze/counts': {
    summary: 'Count cards per bank',
    tag: 'Practice',
    sharedParams: LANG,
    responses: {
      '200': {
        description: 'Totals for each bank.',
        schema: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              due: { type: 'integer' },
              mastered: { type: 'integer' },
            },
          },
        },
      },
    },
  },
  'GET /api/cloze/stats': {
    summary: 'Get lifetime practice totals',
    tag: 'Practice',
    sharedParams: LANG,
    responses: {
      '200': {
        description: 'Correct and incorrect answers, summed over every card.',
        schema: {
          type: 'object',
          properties: { timesCorrect: { type: 'integer' }, timesIncorrect: { type: 'integer' } },
        },
      },
    },
  },
  'GET /api/cloze/seed': {
    summary: 'Check whether the card bank needs a seed',
    tag: 'Practice',
    sharedParams: LANG,
    responses: {
      '200': {
        description: 'Card counts, and the advice to seed.',
        schema: {
          type: 'object',
          properties: {
            dbCount: { type: 'integer', description: 'Cards the account holds.' },
            bankSize: { type: 'integer', description: 'Cards in the built-in bank.' },
            needsSeed: { type: 'boolean' },
          },
        },
      },
    },
  },
  'POST /api/cloze/seed': {
    summary: 'Seed cards from the built-in bank',
    description: 'Adds the missing cards for the language. Repeat calls are safe.',
    tag: 'Practice',
    sharedParams: LANG,
    responses: {
      '200': {
        description: 'What the seed changed.',
        schema: {
          type: 'object',
          properties: {
            seeded: { type: 'integer' },
            updated: { type: 'integer' },
            mined: { type: 'integer' },
            tatoeba: { type: 'integer' },
            total: { type: 'integer' },
          },
        },
      },
    },
  },
  'GET /api/cloze/onboarding': {
    summary: 'Get the guided first-run cards',
    tag: 'Practice',
    sharedParams: LANG,
    query: [
      {
        name: 'vocabIds',
        description: 'Comma-separated vocabulary identifiers. Between 1 and 20.',
        schema: { type: 'string' },
        required: true,
      },
    ],
    responses: {
      '200': {
        description: 'The cards, in the order you asked for.',
        schema: arrayOf('ClozeCard'),
      },
    },
  },
  'POST /api/cloze/onboarding': {
    summary: 'Create a guided first-run card',
    description: 'The identifier comes from `vocabId`, so a repeat call updates the same card.',
    tag: 'Practice',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          vocabId: { type: 'string' },
          word: { type: 'string' },
          sentence: { type: 'string' },
          translation: { type: 'string' },
          language: { type: 'string' },
        },
        required: ['vocabId', 'word', 'sentence', 'translation', 'language'],
      },
    },
    responses: {
      '200': { description: 'The card already existed and is updated.', schema: ref('ClozeCard') },
      '201': { description: 'The card is created.', schema: ref('ClozeCard') },
    },
  },
  'GET /api/cloze/{id}': {
    notFound: true,
    summary: 'Get one practice card',
    tag: 'Practice',
    sharedParams: LANG,
    pathParams: { id: 'Card identifier.' },
    responses: { '200': { description: 'The card.', schema: ref('ClozeCard') } },
  },
  'PUT /api/cloze/{id}': {
    notFound: true,
    summary: 'Update a practice card',
    tag: 'Practice',
    sharedParams: LANG,
    pathParams: { id: 'Card identifier.' },
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        description: 'Send only the fields to change.',
        properties: {
          sentence: { type: 'string' },
          clozeWord: { type: 'string' },
          clozeIndex: { type: 'integer' },
          translation: { type: 'string' },
          masteryLevel: { type: 'integer', enum: [0, 25, 50, 75, 100] },
          nextReview: ISO_DATE_TIME,
          reviewCount: { type: 'integer' },
          lastReviewed: { type: ['string', 'null'], format: 'date-time' },
          timesCorrect: { type: 'integer' },
          timesIncorrect: { type: 'integer' },
          blacklisted: { type: 'integer', enum: [0, 1] },
        },
      },
    },
    responses: { '200': { description: 'The card is updated.', schema: ref('Success') } },
  },
  'DELETE /api/cloze/{id}': {
    summary: 'Delete a practice card',
    tag: 'Practice',
    sharedParams: LANG,
    pathParams: { id: 'Card identifier.' },
    responses: { '200': { description: 'The card is deleted.', schema: ref('Success') } },
  },
  'POST /api/cloze/{id}/review': {
    notFound: true,
    summary: 'Record a practice answer',
    description:
      'The client owns the schedule. Send the new mastery level and the next review time with the answer.',
    tag: 'Practice',
    sharedParams: LANG,
    pathParams: { id: 'Card identifier.' },
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          correct: { type: 'boolean' },
          masteryLevel: { type: 'integer', enum: [0, 25, 50, 75, 100] },
          nextReview: ISO_DATE_TIME,
        },
        required: ['correct', 'masteryLevel', 'nextReview'],
      },
    },
    responses: { '200': { description: 'The answer is recorded.', schema: ref('Success') } },
  },
};

const dictionaryOps: Record<string, OperationDoc> = {
  'GET /api/dictionary/lookup': {
    summary: 'Look up a word',
    description:
      'Searches the built-in dictionary, its inflection tables, and the translations you accepted. A miss answers `200` with a null entry, so fall back to `POST /api/translate`.',
    tag: 'Dictionary',
    sharedParams: LANG,
    query: [
      {
        name: 'word',
        description: 'The word to look up.',
        schema: { type: 'string' },
        required: true,
      },
    ],
    responses: {
      '200': {
        description: 'The entry, or null on a miss.',
        schema: {
          type: 'object',
          properties: { entry: { oneOf: [ref('DictionaryEntry'), { type: 'null' }] } },
          required: ['entry'],
        },
      },
    },
  },
  'POST /api/dictionary/cache': {
    summary: 'Accept a translation into the dictionary',
    description:
      'Stores a machine translation the user accepted. Later lookups of the word answer from the cache, at no cost.',
    tag: 'Dictionary',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          language: { type: 'string' },
          senses: {
            type: 'array',
            items: {
              type: 'object',
              properties: { partOfSpeech: { type: 'string' }, gloss: { type: 'string' } },
              required: ['partOfSpeech', 'gloss'],
            },
            minItems: 1,
          },
          ipa: { type: 'string' },
          etymology: { type: 'string' },
        },
        required: ['word', 'senses'],
      },
    },
    responses: {
      '200': {
        description: 'The entry is cached.',
        schema: {
          type: 'object',
          properties: { word: { type: 'string', description: 'The stored word key.' } },
        },
      },
    },
  },
};

const WORD_ENTRY_RESPONSE: JsonSchema = {
  type: 'object',
  properties: {
    translation: { type: 'string', description: 'Every sense gloss, joined.' },
    partOfSpeech: { type: 'string', description: 'Part of speech of the first sense.' },
    word: { type: 'string' },
    senses: {
      type: 'array',
      items: {
        type: 'object',
        properties: { partOfSpeech: { type: 'string' }, gloss: { type: 'string' } },
      },
    },
    ipa: { type: 'string' },
    etymology: { type: 'string' },
    relatedForms: {
      type: 'array',
      items: {
        type: 'object',
        properties: { form: { type: 'string' }, relation: { type: 'string' } },
      },
    },
  },
};

const languageHelpOps: Record<string, OperationDoc> = {
  'POST /api/translate': {
    summary: 'Translate a word or phrase',
    description:
      'Asks the language model for a translation in context. Look the word up in the dictionary first: a cached hit costs nothing.',
    tag: 'Language help',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          word: { type: 'string', description: 'The word or phrase. A word must be one token.' },
          type: { type: 'string', enum: ['word', 'phrase'] },
          sentence: { type: 'string', description: 'The sentence around it. Improves the result.' },
          language: { type: 'string' },
        },
        required: ['word', 'type'],
      },
    },
    responses: {
      '200': {
        description: 'A phrase returns a plain translation. A word returns a full entry.',
        schema: {
          oneOf: [
            { type: 'object', properties: { translation: { type: 'string' } } },
            WORD_ENTRY_RESPONSE,
          ],
        },
      },
      '429': {
        description: 'The plan allowance or the burst limit stopped the call.',
        schema: {
          type: 'object',
          properties: { error: { type: 'string' }, retryAfterSeconds: { type: 'integer' } },
        },
      },
    },
  },
  'POST /api/translate/gloss': {
    summary: 'Get a short gloss for a word',
    description:
      'The fast path the reader uses when the dictionary misses. Returns one short meaning.',
    tag: 'Language help',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          word: { type: 'string', description: 'One token.' },
          sentence: { type: 'string' },
          language: { type: 'string' },
        },
        required: ['word'],
      },
    },
    responses: {
      '200': {
        description: 'The gloss, streamed as plain text. Read the body as a stream.',
        contentType: 'text/plain',
        schema: { type: 'string' },
      },
    },
  },
  'POST /api/translate/enrich': {
    summary: 'Enrich a word entry',
    description:
      'Returns pronunciation, etymology and related forms as well as the senses. The Free plan needs your own provider key for this call.',
    tag: 'Language help',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          word: { type: 'string', description: 'One token.' },
          sentence: { type: 'string' },
          language: { type: 'string' },
        },
        required: ['word'],
      },
    },
    responses: { '200': { description: 'The enriched entry.', schema: WORD_ENTRY_RESPONSE } },
  },
  'POST /api/explain': {
    summary: 'Explain a practice sentence',
    description: 'Explains the grammar of a sentence, and why the blanked word fits.',
    tag: 'Language help',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          sentence: { type: 'string' },
          translation: { type: 'string' },
          clozeWord: { type: 'string' },
          language: { type: 'string' },
        },
        required: ['sentence', 'translation'],
      },
    },
    responses: {
      '200': {
        description: 'The explanation, as Markdown.',
        schema: { type: 'object', properties: { explanation: { type: 'string' } } },
      },
    },
  },
  'POST /api/tts': {
    summary: 'Synthesize speech',
    description:
      'Returns the audio as base64. Some language packs have no voice, and answer `404` with `noAudio`. Do not fall back to a browser voice for those packs.',
    tag: 'Language help',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'At most 5,000 bytes.' },
          rate: { type: 'number', description: 'Speaking rate. The default is 0.9.' },
          language: { type: 'string' },
        },
        required: ['text'],
      },
    },
    responses: {
      '200': {
        description: 'The audio.',
        schema: {
          type: 'object',
          properties: {
            audioContent: { type: 'string', description: 'Base64 audio.' },
            contentType: { type: 'string', enum: ['audio/mp3', 'audio/wav'] },
          },
        },
      },
      '404': {
        description: 'The language pack has no synthesized voice.',
        schema: {
          type: 'object',
          properties: { error: { type: 'string' }, noAudio: { type: 'boolean' } },
        },
      },
      '503': {
        description: 'This deployment has no voice configured. Use a local voice instead.',
        schema: {
          type: 'object',
          properties: { error: { type: 'string' }, fallback: { type: 'boolean' } },
        },
      },
    },
  },
  'GET /api/tatoeba': {
    summary: 'Search example sentences',
    description: 'Reads the Tatoeba corpus and returns sentences with an English translation.',
    tag: 'Language help',
    sharedParams: LANG,
    query: [
      {
        name: 'query',
        description: 'Search text. Omit it for random sentences.',
        schema: { type: 'string' },
      },
      {
        name: 'limit',
        description: 'Maximum sentences. The ceiling is 100, and the default is 20.',
        schema: { type: 'integer' },
      },
    ],
    responses: {
      '200': {
        description: 'Matching sentences.',
        schema: {
          type: 'object',
          properties: {
            sentences: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  text: { type: 'string' },
                  lang: { type: 'string' },
                  translation: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      text: { type: 'string' },
                      lang: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const journalOps: Record<string, OperationDoc> = {
  'GET /api/journal': {
    summary: 'List journal entries',
    tag: 'Journal',
    sharedParams: LANG,
    query: [
      { name: 'date', description: 'Return only entries with this entry date.', schema: ISO_DATE },
      {
        name: 'limit',
        description: 'Maximum entries. The default is 20.',
        schema: { type: 'integer' },
      },
      {
        name: 'offset',
        description: 'Entries to skip. The default is 0.',
        schema: { type: 'integer' },
      },
    ],
    responses: { '200': { description: 'Matching entries.', schema: arrayOf('JournalEntry') } },
  },
  'POST /api/journal': {
    summary: 'Create a journal entry',
    tag: 'Journal',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'The text of the entry.' },
          entryDate: ISO_DATE,
          language: { type: 'string' },
        },
        required: ['body'],
      },
    },
    responses: {
      '200': {
        description: 'The new entry.',
        schema: {
          type: 'object',
          properties: { id: { type: 'string' }, entryDate: ISO_DATE },
        },
      },
    },
  },
  'GET /api/journal/{id}': {
    notFound: true,
    summary: 'Get a journal entry',
    tag: 'Journal',
    sharedParams: LANG,
    pathParams: { id: 'Entry identifier.' },
    responses: { '200': { description: 'The entry.', schema: ref('JournalEntry') } },
  },
  'PUT /api/journal/{id}': {
    notFound: true,
    summary: 'Update a journal entry',
    tag: 'Journal',
    sharedParams: LANG,
    pathParams: { id: 'Entry identifier.' },
    requestBody: {
      required: true,
      schema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
    },
    responses: {
      '200': { description: 'The entry is updated.', schema: ref('Success') },
      '400': {
        description: 'The entry is already submitted, so the text is locked.',
        schema: ref('Error'),
      },
    },
  },
  'DELETE /api/journal/{id}': {
    notFound: true,
    summary: 'Delete a journal entry',
    tag: 'Journal',
    sharedParams: LANG,
    pathParams: { id: 'Entry identifier.' },
    responses: { '200': { description: 'The entry is deleted.', schema: ref('Success') } },
  },
  'POST /api/journal/{id}/correct': {
    notFound: true,
    summary: 'Correct a journal entry',
    description:
      'Runs the language model over the entry, stores the corrected text, and sets the status to `submitted`.',
    tag: 'Journal',
    sharedParams: LANG,
    pathParams: { id: 'Entry identifier.' },
    responses: {
      '200': {
        description: 'The correction.',
        schema: {
          type: 'object',
          properties: {
            correctedBody: NULLABLE_STRING,
            corrections: { type: 'array', items: ref('Correction') },
          },
        },
      },
    },
  },
  'POST /api/journal-correct': {
    summary: 'Correct text without storing it',
    description: 'Corrects a piece of text and returns the result. Nothing is stored.',
    tag: 'Journal',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'The text to correct.' },
          language: { type: 'string' },
        },
        required: ['body'],
      },
    },
    responses: {
      '200': {
        description: 'The correction. Nothing is stored.',
        schema: {
          type: 'object',
          properties: {
            correctedBody: { type: 'string' },
            corrections: { type: 'array', items: ref('Correction') },
          },
        },
      },
    },
  },
};

const statsOps: Record<string, OperationDoc> = {
  'GET /api/stats': {
    summary: 'List daily statistics',
    description: 'One row per day, oldest first. Give a date range, or a number of days.',
    tag: 'Statistics',
    sharedParams: LANG,
    query: [
      {
        name: 'startDate',
        description: 'First day of the range. Pair it with `endDate`.',
        schema: ISO_DATE,
      },
      { name: 'endDate', description: 'Last day of the range.', schema: ISO_DATE },
      {
        name: 'days',
        description: 'Days back from today. Ignored when a range is given.',
        schema: { type: 'integer' },
      },
    ],
    responses: { '200': { description: 'Daily rows.', schema: arrayOf('DailyStats') } },
  },
  'GET /api/stats/today': {
    summary: 'Get the statistics for today',
    description:
      'Creates the row for today if it does not exist. Day rollover follows the time zone setting.',
    tag: 'Statistics',
    sharedParams: LANG,
    responses: { '200': { description: 'The row for today.', schema: ref('DailyStats') } },
  },
  'PUT /api/stats/today': {
    summary: 'Add to a counter for today',
    description: 'Adds `amount` to one counter. The call is an increment, not a set.',
    tag: 'Statistics',
    sharedParams: LANG,
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          field: {
            type: 'string',
            enum: [
              'wordsRead',
              'newWordsSaved',
              'wordsMarkedKnown',
              'minutesRead',
              'clozePracticed',
              'points',
              'dictionaryLookups',
              'ankiReviews',
            ],
          },
          amount: { type: 'integer', minimum: 0, description: 'The default is 1.' },
        },
        required: ['field'],
      },
    },
    responses: { '200': { description: 'The counter is updated.', schema: ref('Success') } },
  },
  'GET /api/stats/fluency': {
    summary: 'Get the fluency estimate',
    description: 'Counts words by state, estimates a CEFR band, and reports growth over two weeks.',
    tag: 'Statistics',
    sharedParams: LANG,
    responses: {
      '200': {
        description: 'The estimate.',
        schema: {
          type: 'object',
          properties: {
            totalKnownWords: { type: 'integer' },
            totalLearning: { type: 'integer' },
            totalNew: { type: 'integer' },
            byState: { type: 'object', additionalProperties: { type: 'integer' } },
            byDomain: {
              type: 'array',
              items: { type: 'object' },
              description: 'Per-domain axes for the radar chart.',
            },
            pending: { type: 'integer', description: 'Words with no domain yet.' },
            estimatedLevel: { type: 'string' },
            nextLevel: { type: 'string' },
            progressToNextLevel: { type: 'number' },
            wordsToNextLevel: { type: 'integer' },
            weeklyGrowth: {
              type: 'object',
              properties: {
                thisWeek: { type: 'integer' },
                lastWeek: { type: 'integer' },
                delta: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  },
  'GET /api/stats/streak': {
    summary: 'Get the study streak',
    description:
      'One value for the whole account. A day counts as active after any lookup, practice, reading time or Anki review, in any language.',
    tag: 'Statistics',
    responses: {
      '200': {
        description: 'The streak.',
        schema: {
          type: 'object',
          properties: {
            streak: { type: 'integer', description: 'Days in the current streak.' },
            longest: { type: 'integer' },
            practicedToday: { type: 'boolean' },
          },
        },
      },
    },
  },
  'GET /api/stats/activity': {
    summary: 'Get daily activity for the heatmap',
    description: 'Sums each day across every language, to match the streak.',
    tag: 'Statistics',
    responses: {
      '200': {
        description: 'One row per day, oldest first.',
        schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: ISO_DATE,
              dictionaryLookups: { type: 'integer' },
              clozePracticed: { type: 'integer' },
              minutesRead: { type: 'integer' },
              ankiReviews: { type: 'integer' },
            },
          },
        },
      },
    },
  },
  'GET /api/stats/reading': {
    summary: 'Get estimated reading volume',
    description: 'Derived from the scroll progress of each lesson in the language.',
    tag: 'Statistics',
    sharedParams: LANG,
    responses: {
      '200': {
        description: 'Reading totals.',
        schema: {
          type: 'object',
          properties: {
            wordsRead: { type: 'integer', description: 'Estimated words read, over every lesson.' },
            totalWords: { type: 'integer', description: 'Words in the library.' },
            lessonsTotal: { type: 'integer' },
            lessonsStarted: { type: 'integer' },
            lessonsCompleted: { type: 'integer' },
          },
        },
      },
    },
  },
  'GET /api/study-ping': {
    summary: 'Check whether study happened today',
    description: 'Aggregated across every language. Built for an external agent to poll.',
    tag: 'Statistics',
    responses: {
      '200': {
        description: 'The activity for today.',
        schema: {
          type: 'object',
          properties: {
            done: { type: 'boolean' },
            date: ISO_DATE,
            minutes: { type: 'integer' },
            lookups: { type: 'integer' },
            clozePracticed: { type: 'integer' },
            sessionStartedAt: { type: ['string', 'null'], format: 'date-time' },
          },
        },
      },
    },
  },
  'POST /api/study-ping': {
    summary: 'Record the start of a study session',
    description: 'Stores the session start time once per day, on the row of the active language.',
    tag: 'Statistics',
    sharedParams: LANG,
    responses: {
      '200': {
        description: 'The activity for today.',
        schema: {
          type: 'object',
          properties: {
            done: { type: 'boolean' },
            date: ISO_DATE,
            minutes: { type: 'integer' },
            lookups: { type: 'integer' },
            sessionStartedAt: { type: ['string', 'null'], format: 'date-time' },
          },
        },
      },
    },
  },
};

const ankiOps: Record<string, OperationDoc> = {
  'GET /api/anki': {
    summary: 'Check the Anki connection',
    description:
      'Reads the deck list through the AnkiConnect add-on. Anki must run on the same host as the API.',
    tag: 'Anki',
    responses: {
      '200': {
        description: 'Connection state and decks. An unreachable Anki answers `connected: false`.',
        schema: {
          type: 'object',
          properties: {
            connected: { type: 'boolean' },
            version: { type: 'integer' },
            decks: { type: 'array', items: { type: 'string' } },
            error: { type: 'string' },
          },
        },
      },
    },
  },
  'POST /api/anki': {
    summary: 'Call an allowed AnkiConnect action',
    description:
      'Passes one allowed action to AnkiConnect. The API syncs reviews after it adds a note.',
    tag: 'Anki',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'An allowed AnkiConnect action.' },
          params: { type: 'object' },
        },
        required: ['action'],
      },
    },
    responses: {
      '200': { description: 'The result from AnkiConnect.', schema: { type: 'object' } },
    },
  },
  'POST /api/anki/queue': {
    summary: 'Queue vocabulary as Anki cards',
    description:
      'Adds pending cards for the add-on to pull. A second call for the same entry replaces its pending row.',
    tag: 'Anki',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                vocabId: { type: 'string' },
                cardType: { type: 'string', enum: ['basic', 'word', 'cloze'] },
                word: NULLABLE_STRING,
                sentence: NULLABLE_STRING,
                translation: NULLABLE_STRING,
                meaning: NULLABLE_STRING,
                sourceUrl: {
                  ...NULLABLE_STRING,
                  description: 'Video URL, for a card mined from a transcript.',
                },
                clipStartMs: { type: ['integer', 'null'] },
                clipEndMs: { type: ['integer', 'null'] },
              },
              required: ['vocabId'],
            },
          },
        },
        required: ['items'],
      },
    },
    responses: {
      '200': {
        description: 'How many cards the queue took, and how many it refused.',
        schema: {
          type: 'object',
          properties: { queued: { type: 'integer' }, failed: { type: 'integer' } },
        },
      },
    },
  },
  'GET /api/anki/pending': {
    summary: 'Pull the pending card batch',
    description:
      'Returns one batch, and how many rows remain. Loop the pull, the write and the acknowledgement until the queue is empty.',
    tag: 'Anki',
    responses: {
      '200': {
        description: 'The batch, and the rows that remain after it.',
        schema: {
          type: 'object',
          properties: {
            pending: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  lectorId: { type: 'string', description: 'The vocabulary entry identifier.' },
                  cardType: { type: 'string', enum: ['basic', 'word', 'cloze'] },
                  word: NULLABLE_STRING,
                  sentence: NULLABLE_STRING,
                  translation: NULLABLE_STRING,
                  meaning: NULLABLE_STRING,
                  language: { type: 'string' },
                  sourceUrl: NULLABLE_STRING,
                  clipStartMs: { type: ['integer', 'null'] },
                  clipEndMs: { type: ['integer', 'null'] },
                  queuedAt: ISO_DATE_TIME,
                  version: { type: 'integer', description: 'Echo it back on the acknowledgement.' },
                },
              },
            },
            remaining: { type: 'integer', description: 'Advisory count, for progress output.' },
          },
        },
      },
    },
  },
  'POST /api/anki/ack': {
    summary: 'Acknowledge created or updated notes',
    description:
      'Marks the vocabulary entries as pushed, and clears the pending rows. Echo the `version` from the pull. A card queued again then survives a late acknowledgement.',
    tag: 'Anki',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                vocabId: { type: 'string' },
                ankiNoteId: { type: 'integer' },
                version: { type: 'integer' },
              },
              required: ['vocabId'],
            },
          },
        },
        required: ['results'],
      },
    },
    responses: {
      '200': {
        description: 'How many rows the acknowledgement cleared.',
        schema: { type: 'object', properties: { acked: { type: 'integer' } } },
      },
    },
  },
  'POST /api/anki/reviews': {
    summary: 'Report reviews from the add-on',
    description:
      'Raises the word state from the Anki review history. The endpoint never lowers a state, and never changes `ignored`.',
    tag: 'Anki',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        description: 'Send `reviews`, `reviewsByDay`, or an `inventory`.',
        properties: {
          reviews: {
            type: 'array',
            items: {
              type: 'object',
              properties: { type: { type: 'string' }, interval: { type: 'number' } },
            },
          },
          reviewsByDay: {
            type: 'array',
            items: { type: 'object', properties: { date: ISO_DATE, count: { type: 'integer' } } },
          },
          inventory: { type: 'object', description: 'The notes the add-on holds.' },
        },
      },
    },
    responses: { '200': { description: 'What the report changed.', schema: { type: 'object' } } },
  },
  'POST /api/anki/sync-reviews': {
    summary: 'Sync the daily review counts from Anki',
    description:
      'Reads the review counts through AnkiConnect and stores them, so the heatmap and the streak count Anki days. An unreachable Anki leaves the stored data alone.',
    tag: 'Anki',
    responses: { '200': { description: 'What the sync changed.', schema: { type: 'object' } } },
  },
};

const SETTING_KEYS = [
  'targetLanguage',
  'enabledLanguages',
  'timezone',
  'llmProvider',
  'openaiPreset',
  'openaiUrl',
  'openaiModel',
  'openaiApiKey',
  'anthropicApiKey',
  'claudeOauthToken',
  'anthropicAuthMode',
  'ankiConnectUrl',
  'ankiTransport',
  'ollamaModel',
  'apfelUrl',
  'apfelModel',
  'lmstudioUrl',
  'lmstudioModel',
  'lmstudioApiKey',
];

const settingsOps: Record<string, OperationDoc> = {
  'GET /api/settings': {
    summary: 'Get every setting',
    description:
      'Returns one object, keyed by setting name. A credential reads back as `true`, never as its value.',
    tag: 'Settings',
    responses: {
      '200': { description: 'The settings of the account.', schema: { type: 'object' } },
    },
  },
  'PUT /api/settings': {
    summary: 'Write settings in bulk',
    description:
      'Writes every pair in the body. The API rejects the whole batch if one key is unknown, so a bad call changes nothing.',
    tag: 'Settings',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        description: 'Setting name to value. Only the listed names are accepted.',
        propertyNames: { enum: SETTING_KEYS },
      },
    },
    responses: { '200': { description: 'The settings are stored.', schema: ref('Success') } },
  },
  'GET /api/settings/{key}': {
    summary: 'Get one setting',
    description: 'Returns the value, or null when the account has no such setting.',
    tag: 'Settings',
    pathParams: { key: 'Setting name.' },
    responses: {
      '200': {
        description: 'The value. A credential reads back as `true`.',
        schema: { description: 'Any JSON value, or null.' },
      },
    },
  },
  'PUT /api/settings/{key}': {
    summary: 'Write one setting',
    tag: 'Settings',
    pathParams: { key: 'Setting name.' },
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: { value: { description: 'Any JSON value.' } },
        required: ['value'],
      },
    },
    responses: { '200': { description: 'The setting is stored.', schema: ref('Success') } },
  },
  'DELETE /api/settings/{key}': {
    summary: 'Delete one setting',
    tag: 'Settings',
    pathParams: { key: 'Setting name.' },
    responses: { '200': { description: 'The setting is deleted.', schema: ref('Success') } },
  },
  'GET /api/byok': {
    summary: 'Get the provider key state',
    description:
      'Reports whether this deployment accepts your own provider key, and which key the account holds.',
    tag: 'Settings',
    responses: {
      '200': {
        description: 'The state.',
        schema: {
          type: 'object',
          properties: {
            available: { type: 'boolean', description: 'True when the deployment accepts a key.' },
            enabled: { type: 'boolean', description: 'True when the account holds a key.' },
            provider: { type: 'string' },
            model: { type: 'string' },
            providers: { type: 'object', description: 'Each provider, and the models it allows.' },
          },
        },
      },
    },
  },
  'PUT /api/byok': {
    summary: 'Store your own provider key',
    description:
      'Validates the key against the provider, then stores it. Send the key only. The API never reads it back.',
    tag: 'Settings',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['anthropic', 'openrouter'] },
          apiKey: { type: 'string', description: 'At most 512 characters.' },
          model: { type: 'string', description: 'A model the provider catalog lists.' },
        },
      },
    },
    responses: {
      '200': {
        description: 'The key is stored.',
        schema: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            provider: { type: 'string' },
            model: { type: 'string' },
          },
        },
      },
      '503': { description: 'This deployment does not accept your own key.', schema: ref('Error') },
    },
  },
  'DELETE /api/byok': {
    summary: 'Delete your provider key',
    tag: 'Settings',
    responses: {
      '200': {
        description: 'The key is deleted.',
        schema: { type: 'object', properties: { enabled: { type: 'boolean', enum: [false] } } },
      },
    },
  },
  'GET /api/llm-status': {
    summary: 'Check the language model provider',
    description: 'Reports the provider, the model, and the result of a health check.',
    tag: 'Settings',
    responses: {
      '200': {
        description: 'Provider health.',
        schema: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            model: { type: 'string' },
            ok: { type: 'boolean' },
          },
        },
      },
    },
  },
  'POST /api/llm-status/test': {
    summary: 'Send a test completion',
    description: 'Asks the provider for one tiny completion. The call spends monthly allowance.',
    tag: 'Settings',
    responses: {
      '200': {
        description: 'The provider answered.',
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, response: { type: 'string' } },
        },
      },
      '500': {
        description: 'The provider failed. The allowance is returned.',
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean', enum: [false] }, error: { type: 'string' } },
        },
      },
    },
  },
  'POST /api/llm-status/reset': {
    summary: 'Clear the cached provider',
    description:
      'Call this after a provider setting changes, so the next call builds a new client.',
    tag: 'Settings',
    responses: {
      '200': {
        description: 'The cache is clear.',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      },
    },
  },
  'POST /api/llm/openai/models': {
    summary: 'List the models of an OpenAI-compatible endpoint',
    description:
      'Asks the endpoint for its model list, from the server. Self-hosted deployments only. Cloud answers `404`.',
    tag: 'Settings',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          endpoint: { type: 'string', description: 'Base URL of the endpoint.' },
          apiKey: { type: 'string', description: 'Omit it to use the stored key.' },
        },
        required: ['endpoint'],
      },
    },
    responses: {
      '200': {
        description: 'The models.',
        schema: {
          type: 'object',
          properties: { models: { type: 'array', items: { type: 'object' } } },
        },
      },
      '404': { description: 'Not available on this deployment.', schema: ref('Error') },
      '502': { description: 'The endpoint refused the call.', schema: ref('Error') },
    },
  },
};

const dataOps: Record<string, OperationDoc> = {
  'GET /api/data': {
    summary: 'Export the learning data',
    description:
      'Returns every portable record for the account. Credentials, billing state and cached shared content stay out.',
    tag: 'Data',
    responses: { '200': { description: 'The export.', schema: ref('UserExport') } },
  },
  'POST /api/data': {
    summary: 'Restore learning data',
    description:
      'Writes the records of an export into the account. The restored rows become yours, whatever the file says. One restore runs at a time.',
    tag: 'Data',
    requestBody: { required: true, schema: ref('UserExport') },
    responses: {
      '200': {
        description: 'The restore finished. `imported` counts the rows per table.',
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            imported: { type: 'object', additionalProperties: { type: 'integer' } },
          },
        },
      },
      '409': { description: 'A restore is already running for the account.', schema: ref('Error') },
      '503': {
        description: 'The restore capacity is busy. Try again shortly.',
        schema: ref('Error'),
      },
    },
  },
};

const chatOps: Record<string, OperationDoc> = {
  'GET /api/chat': {
    summary: 'Get the conversation history',
    description: 'Returns messages oldest first. Page back with `before`.',
    tag: 'Chat',
    sharedParams: LANG,
    query: [
      {
        name: 'limit',
        description: 'Maximum messages. The default is 50.',
        schema: { type: 'integer' },
      },
      {
        name: 'before',
        description: 'Return messages created before this time. Use it to page back.',
        schema: ISO_DATE_TIME,
      },
    ],
    responses: {
      '200': {
        description: 'The messages.',
        schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              role: { type: 'string', enum: ['user', 'assistant'] },
              content: { type: 'string' },
              provider: NULLABLE_STRING,
              responseId: NULLABLE_STRING,
              language: { type: 'string' },
              createdAt: ISO_DATE_TIME,
            },
          },
        },
      },
    },
  },
  'POST /api/chat': {
    summary: 'Send a chat message',
    description:
      'Sends the message to the language model and returns the answer. The Free plan answers without storing the history.',
    tag: 'Chat',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'At most 32 KiB.' },
          language: { type: 'string' },
        },
        required: ['message'],
      },
    },
    responses: {
      '200': {
        description: 'Both messages of the exchange.',
        schema: {
          type: 'object',
          properties: {
            userMessage: { type: 'object' },
            assistantMessage: { type: 'object' },
          },
        },
      },
    },
  },
  'DELETE /api/chat': {
    summary: 'Clear the conversation history',
    tag: 'Chat',
    sharedParams: LANG,
    responses: {
      '200': {
        description: 'The history is deleted.',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      },
    },
  },
};

const PROFILE_BODY: JsonSchema = {
  type: 'object',
  properties: {
    language: { type: 'string' },
    approximateLevel: {
      type: 'string',
      enum: ['new', 'beginner', 'intermediate', 'advanced', 'not_sure'],
    },
    interests: {
      type: 'array',
      items: { type: 'string' },
      description: 'Supported interest names.',
    },
    dailyMinutes: { type: 'integer', minimum: 5, maximum: 120 },
  },
  required: ['language', 'approximateLevel', 'interests', 'dailyMinutes'],
};

const onboardingOps: Record<string, OperationDoc> = {
  'GET /api/onboarding': {
    summary: 'Get the guided first-run state',
    description:
      'Returns the profile, the current step, and the recommended lesson. An account with a language but no row is an existing user.',
    tag: 'Onboarding',
    responses: { '200': { description: 'The state.', schema: ref('OnboardingSnapshot') } },
  },
  'POST /api/onboarding/start': {
    summary: 'Start the guided first run',
    description: 'Stores the learner profile and picks a starter lesson.',
    tag: 'Onboarding',
    requestBody: { required: true, schema: PROFILE_BODY },
    responses: { '200': { description: 'The new state.', schema: ref('OnboardingSnapshot') } },
  },
  'POST /api/onboarding/skip': {
    summary: 'Skip the guided first run',
    description: 'Stores the profile and the target language, then marks the run skipped.',
    tag: 'Onboarding',
    requestBody: { required: true, schema: PROFILE_BODY },
    responses: { '200': { description: 'The new state.', schema: ref('OnboardingSnapshot') } },
  },
  'PATCH /api/onboarding': {
    summary: 'Advance the guided first run',
    tag: 'Onboarding',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          currentStep: { type: 'string', enum: ['reader', 'practice', 'summary'] },
          nextLessonId: { type: 'string' },
          nextLessonTitle: { type: 'string' },
        },
      },
    },
    responses: {
      '200': { description: 'The new state.', schema: ref('OnboardingSnapshot') },
      '409': { description: 'The guided first run has not started.', schema: ref('Error') },
    },
  },
  'POST /api/onboarding/complete': {
    summary: 'Finish the guided first run',
    tag: 'Onboarding',
    responses: {
      '200': { description: 'The new state.', schema: ref('OnboardingSnapshot') },
      '409': { description: 'The guided first run has not started.', schema: ref('Error') },
    },
  },
  'POST /api/learner-events': {
    summary: 'Record a learner event',
    description:
      'Stores one product analytics event for the account. Send an `idempotencyKey` to make a retry safe.',
    tag: 'Onboarding',
    requestBody: {
      required: true,
      schema: {
        type: 'object',
        properties: {
          eventType: {
            type: 'string',
            enum: [
              'onboarding.started',
              'onboarding.profile_saved',
              'onboarding.skipped',
              'lesson.opened',
              'reader.term_looked_up',
              'vocab.saved',
              'vocab.state_changed',
              'practice.answer_submitted',
              'practice.round_completed',
              'onboarding.completed',
            ],
          },
          language: { type: 'string' },
          lessonId: { ...NULLABLE_STRING, description: 'Required for `lesson.opened`.' },
          vocabId: { ...NULLABLE_STRING, description: 'Required for the two `vocab.*` events.' },
          properties: { type: 'object' },
          idempotencyKey: NULLABLE_STRING,
        },
        required: ['eventType', 'language'],
      },
    },
    responses: {
      '200': {
        description: 'The event is a repeat, so nothing changed.',
        schema: { type: 'object' },
      },
      '201': { description: 'The event is recorded.', schema: { type: 'object' } },
    },
  },
};

const serviceOps: Record<string, OperationDoc> = {
  'GET /health': {
    summary: 'Check that the service runs',
    description: 'Answers without a credential. Reports the deployment mode.',
    tag: 'Service',
    auth: 'none',
    visibility: 'public',
    responses: {
      '200': {
        description: 'The service runs.',
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            mode: { type: 'string', enum: ['selfhost', 'cloud'] },
          },
        },
      },
    },
  },
};

/**
 * Browser-only and operator-only surfaces.
 *
 * A token cannot reach any of these, so the published document leaves them
 * out. They keep an entry here for two reasons: `--check` stays quiet, and
 * `--include-internal` produces a complete document for our own use.
 */
const internalOps: Record<string, OperationDoc> = {
  'POST /api/tokens': { summary: 'Create a personal access token', tag: 'Settings' },
  'GET /api/tokens': { summary: 'List personal access tokens', tag: 'Settings' },
  'POST /api/tokens/verify': { summary: 'Verify the current token', tag: 'Settings' },
  'DELETE /api/tokens/{id}': { summary: 'Revoke a personal access token', tag: 'Settings' },

  'GET /api/starter/status': {
    summary: 'Check the starter content of a language',
    tag: 'Onboarding',
  },
  'POST /api/starter/seed': {
    summary: 'Seed the starter content of a language',
    tag: 'Onboarding',
  },

  'GET /api/billing/entitlements': {
    summary: 'Read the plan limits and the usage',
    tag: 'Service',
  },
  'GET /api/billing/status': {
    summary: 'Read the subscription state and the prices',
    tag: 'Service',
  },
  'POST /api/billing/checkout': { summary: 'Create a checkout transaction', tag: 'Service' },
  'POST /api/billing/portal': { summary: 'Create a customer portal link', tag: 'Service' },
  'POST /api/billing/change/preview': { summary: 'Preview a plan change', tag: 'Service' },
  'POST /api/billing/change': { summary: 'Apply a plan change', tag: 'Service' },
  'POST /api/billing/webhook': {
    summary: 'Receive a Paddle notification',
    description: 'The signature over the raw body is the credential.',
    tag: 'Service',
    auth: 'none',
  },

  'GET /api/admin/access': { summary: 'Check whether the caller is an operator', tag: 'Service' },
  'GET /api/admin/summary': { summary: 'Read the service-wide aggregates', tag: 'Service' },
  'GET /api/admin/users': { summary: 'List every account', tag: 'Service' },
  'GET /api/admin/users/{id}': { summary: 'Read one account', tag: 'Service' },
  'GET /api/admin/users/{id}/export': { summary: 'Export the data of one account', tag: 'Service' },
  'POST /api/admin/users/{id}/suspend': { summary: 'Suspend an account', tag: 'Service' },
  'POST /api/admin/users/{id}/restore': { summary: 'Lift a suspension', tag: 'Service' },
  'POST /api/admin/users/{id}/comp': {
    summary: 'Grant a complimentary membership',
    tag: 'Service',
  },
  'POST /api/admin/users/{id}/uncomp': {
    summary: 'Revoke a complimentary membership',
    tag: 'Service',
  },
  'POST /api/admin/users/{id}/resync-paddle': {
    summary: 'Repair the billing mirror from Paddle',
    tag: 'Service',
  },
  'POST /api/admin/users/{id}/reset-mfa': {
    summary: 'Clear the two-factor enrolment',
    tag: 'Service',
  },
  'POST /api/admin/users/{id}/password-reset': {
    summary: 'Send a password reset email',
    tag: 'Service',
  },
  'POST /api/admin/users/{id}/resend-verification': {
    summary: 'Send the verification email again',
    tag: 'Service',
  },
  'POST /api/admin/users/{id}/verify': {
    summary: 'Mark an email address verified',
    tag: 'Service',
  },
  'POST /api/admin/users/{id}/revoke-sessions': {
    summary: 'Sign an account out everywhere',
    tag: 'Service',
  },
  'POST /api/admin/users/{id}/impersonate': {
    summary: 'Start a read-only view of an account',
    tag: 'Service',
  },
  'POST /api/admin/impersonation/stop': { summary: 'End the read-only view', tag: 'Service' },
  'GET /api/admin/audit': { summary: 'Read the operator action trail', tag: 'Service' },
  'GET /api/impersonation/status': { summary: 'Read the active read-only view', tag: 'Service' },
};

export const operations: Record<string, OperationDoc> = {
  ...libraryOps,
  ...importOps,
  ...vocabOps,
  ...practiceOps,
  ...dictionaryOps,
  ...languageHelpOps,
  ...journalOps,
  ...statsOps,
  ...ankiOps,
  ...settingsOps,
  ...dataOps,
  ...chatOps,
  ...onboardingOps,
  ...serviceOps,
  ...internalOps,
};

/**
 * Endpoints the route registry cannot describe, because no route module serves
 * them. `index.ts` registers each one directly.
 */
export const extraEndpoints = [{ method: 'GET', path: '/health' }];
