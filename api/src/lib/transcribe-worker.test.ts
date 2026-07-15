import '../test-guard';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import {
  applyTranscript,
  collapseRepeatedSegments,
  resetStaleTranscriptions,
  selectNextPending,
  transcribeNextPending,
  transcriptMarkdown,
  startTranscribeWorker,
  type PendingTranscription,
} from './transcribe-worker';
import type { TranscriptionResult } from './transcription';

const TEST_AUDIO_DIR = path.join(process.env.DATA_DIR || '.test-data', 'worker-audio');

/** The columns the worker touches, with the real tables' shapes. */
function createSchema(db: Database): void {
  db.exec(`
    CREATE TABLE lessons (
      userId TEXT NOT NULL DEFAULT 'local',
      id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      textContent TEXT NOT NULL DEFAULT '',
      wordCount INTEGER DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'af',
      createdAt TEXT NOT NULL,
      audioPath TEXT,
      audioDurationMs INTEGER,
      transcriptionStatus TEXT,
      transcriptionError TEXT,
      transcriptionAttempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (userId, id)
    );
    CREATE TABLE transcript_segments (
      userId TEXT NOT NULL DEFAULT 'local',
      lessonId TEXT NOT NULL,
      idx INTEGER NOT NULL,
      startMs INTEGER NOT NULL,
      endMs INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (userId, lessonId, idx)
    );
  `);
}

function insertLesson(
  db: Database,
  overrides: Partial<{
    id: string;
    audioPath: string | null;
    transcriptionStatus: string | null;
    transcriptionAttempts: number;
    audioDurationMs: number | null;
    createdAt: string;
  }> = {},
): string {
  const id = overrides.id ?? 'lesson-1';
  db.prepare(
    `INSERT INTO lessons (userId, id, title, language, createdAt, audioPath, audioDurationMs, transcriptionStatus, transcriptionAttempts)
     VALUES ('local', ?, 'Episode', 'af', ?, ?, ?, ?, ?)`,
  ).run(
    id,
    overrides.createdAt ?? '2026-07-01T00:00:00Z',
    overrides.audioPath === undefined ? '/tmp/does-not-matter.mp3' : overrides.audioPath,
    overrides.audioDurationMs ?? null,
    overrides.transcriptionStatus === undefined ? 'pending' : overrides.transcriptionStatus,
    overrides.transcriptionAttempts ?? 0,
  );
  return id;
}

function lessonRow(db: Database, id: string) {
  return db.prepare("SELECT * FROM lessons WHERE userId = 'local' AND id = ?").get(id) as {
    textContent: string;
    wordCount: number;
    audioDurationMs: number | null;
    transcriptionStatus: string | null;
    transcriptionError: string | null;
    transcriptionAttempts: number;
  };
}

const RESULT: TranscriptionResult = {
  text: 'Goeie môre almal. Welkom terug.',
  segments: [
    { startMs: 0, endMs: 1500, text: 'Goeie môre almal.' },
    { startMs: 1500, endMs: 3000, text: 'Welkom terug.' },
  ],
  durationMs: 3000,
};

async function realAudioFile(name = 'clip.mp3', bytes = 64): Promise<string> {
  const filePath = path.join(TEST_AUDIO_DIR, name);
  await Bun.write(filePath, new Uint8Array(bytes).fill(7));
  return filePath;
}

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  createSchema(db);
  fs.mkdirSync(TEST_AUDIO_DIR, { recursive: true });
});
afterAll(() => {
  fs.rmSync(TEST_AUDIO_DIR, { recursive: true, force: true });
});

describe('transcriptMarkdown', () => {
  test('groups segments into paragraphs of five sentences', () => {
    const result: TranscriptionResult = {
      text: 'unused',
      segments: Array.from({ length: 7 }, (_, i) => ({
        startMs: i * 1000,
        endMs: (i + 1) * 1000,
        text: `Sin ${i + 1}.`,
      })),
    };
    const markdown = transcriptMarkdown(result);
    expect(markdown.split('\n\n')).toEqual(['Sin 1. Sin 2. Sin 3. Sin 4. Sin 5.', 'Sin 6. Sin 7.']);
  });

  test('falls back to the flat text when the backend returned no segments', () => {
    expect(transcriptMarkdown({ text: 'Net plat teks.', segments: [] })).toBe('Net plat teks.');
  });
});

describe('collapseRepeatedSegments', () => {
  const seg = (idx: number, text: string) => ({
    startMs: idx * 1000,
    endMs: (idx + 1) * 1000,
    text,
  });

  test('caps a Whisper repetition loop at two consecutive copies', () => {
    const looped = [
      seg(0, 'Eerste sin.'),
      ...Array.from({ length: 12 }, (_, i) => seg(i + 1, 'Muziek in die are.')),
      seg(13, 'Laaste sin.'),
    ];
    const kept = collapseRepeatedSegments(looped);
    expect(kept.map((s) => s.text)).toEqual([
      'Eerste sin.',
      'Muziek in die are.',
      'Muziek in die are.',
      'Laaste sin.',
    ]);
  });

  test('leaves genuine (non-consecutive) repeats and short runs alone', () => {
    const segments = [seg(0, 'My God!'), seg(1, 'Wat nou?'), seg(2, 'My God!'), seg(3, 'My God!')];
    expect(collapseRepeatedSegments(segments)).toEqual(segments);
  });

  test('applyTranscript stores the collapsed segments, not the raw loop', () => {
    const id = insertLesson(db);
    const row = selectNextPending(db) as PendingTranscription;
    applyTranscript(db, row, {
      text: 'unused',
      segments: [
        seg(0, 'Sin.'),
        seg(1, 'Loop.'),
        seg(2, 'Loop.'),
        seg(3, 'Loop.'),
        seg(4, 'Loop.'),
      ],
    });
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM transcript_segments WHERE lessonId = ?')
      .get(id) as { n: number };
    expect(count.n).toBe(3);
  });
});

describe('selectNextPending', () => {
  test('picks the oldest pending audio lesson and skips other states', () => {
    insertLesson(db, {
      id: 'done',
      transcriptionStatus: 'done',
      createdAt: '2026-01-01T00:00:00Z',
    });
    insertLesson(db, { id: 'newer', createdAt: '2026-07-02T00:00:00Z' });
    insertLesson(db, { id: 'older', createdAt: '2026-07-01T00:00:00Z' });
    insertLesson(db, { id: 'no-audio', audioPath: null, createdAt: '2025-01-01T00:00:00Z' });

    expect(selectNextPending(db)?.id).toBe('older');
  });

  test('returns null when nothing is pending', () => {
    insertLesson(db, { transcriptionStatus: 'done' });
    expect(selectNextPending(db)).toBeNull();
  });
});

describe('resetStaleTranscriptions', () => {
  test('resets orphaned processing rows back to pending', () => {
    insertLesson(db, { id: 'stuck', transcriptionStatus: 'processing' });
    insertLesson(db, { id: 'fine', transcriptionStatus: 'done' });

    expect(resetStaleTranscriptions(db)).toBe(1);
    expect(lessonRow(db, 'stuck').transcriptionStatus).toBe('pending');
    expect(lessonRow(db, 'fine').transcriptionStatus).toBe('done');
  });
});

describe('applyTranscript', () => {
  test('writes segments, transcript text, word count and status in one go', () => {
    const id = insertLesson(db);
    const row = selectNextPending(db) as PendingTranscription;
    applyTranscript(db, row, RESULT);

    const lesson = lessonRow(db, id);
    expect(lesson.transcriptionStatus).toBe('done');
    expect(lesson.transcriptionError).toBeNull();
    expect(lesson.textContent).toBe('Goeie môre almal. Welkom terug.');
    expect(lesson.wordCount).toBe(5);
    expect(lesson.audioDurationMs).toBe(3000);

    const segments = db
      .prepare(
        'SELECT idx, startMs, endMs, text FROM transcript_segments WHERE lessonId = ? ORDER BY idx',
      )
      .all(id);
    expect(segments).toEqual([
      { idx: 0, startMs: 0, endMs: 1500, text: 'Goeie môre almal.' },
      { idx: 1, startMs: 1500, endMs: 3000, text: 'Welkom terug.' },
    ]);
  });

  test('replaces segments wholesale and keeps an existing probed duration', () => {
    const id = insertLesson(db, { audioDurationMs: 2900 });
    const row = selectNextPending(db) as PendingTranscription;
    applyTranscript(db, row, RESULT);
    applyTranscript(db, row, RESULT); // idempotent under retry

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM transcript_segments WHERE lessonId = ?')
      .get(id) as { n: number };
    expect(count.n).toBe(2);
    // ffprobe's upload-time duration wins over the ASR's estimate.
    expect(lessonRow(db, id).audioDurationMs).toBe(2900);
  });
});

describe('transcribeNextPending', () => {
  test('is idle when nothing is pending', async () => {
    const outcome = await transcribeNextPending(db, async () => RESULT);
    expect(outcome.state).toBe('idle');
  });

  test('claims, transcribes and completes a pending lesson', async () => {
    const audioPath = await realAudioFile();
    const id = insertLesson(db, { audioPath });

    const languages: string[] = [];
    const outcome = await transcribeNextPending(db, async (audio, options) => {
      languages.push(options.language);
      expect(audio.size).toBeGreaterThan(0);
      return RESULT;
    });

    expect(outcome).toEqual({ state: 'done', lessonId: id, segments: 2 });
    expect(languages).toEqual(['af']);
    const lesson = lessonRow(db, id);
    expect(lesson.transcriptionStatus).toBe('done');
    expect(lesson.transcriptionAttempts).toBe(1);
  });

  test('requeues a failed attempt and fails for good at the attempt cap', async () => {
    const audioPath = await realAudioFile();
    const id = insertLesson(db, { audioPath });
    const boom = async () => {
      throw new Error('ASR provider returned 503');
    };

    const first = await transcribeNextPending(db, boom);
    expect(first.state).toBe('retrying');
    expect(lessonRow(db, id).transcriptionStatus).toBe('pending');
    expect(lessonRow(db, id).transcriptionError).toContain('503');

    const second = await transcribeNextPending(db, boom);
    expect(second.state).toBe('retrying');

    const third = await transcribeNextPending(db, boom);
    expect(third.state).toBe('failed');
    expect(lessonRow(db, id).transcriptionStatus).toBe('error');
    expect(lessonRow(db, id).transcriptionAttempts).toBe(3);

    // Terminal: nothing pending anymore.
    expect((await transcribeNextPending(db, boom)).state).toBe('idle');
  });

  test('fails terminally when the audio file is gone (no pointless retries)', async () => {
    const id = insertLesson(db, { audioPath: path.join(TEST_AUDIO_DIR, 'never-written.mp3') });
    const outcome = await transcribeNextPending(db, async () => RESULT);
    expect(outcome.state).toBe('failed');
    expect(lessonRow(db, id).transcriptionStatus).toBe('error');
    expect(lessonRow(db, id).transcriptionError).toContain('missing');
  });

  test('fails terminally when the file exceeds the provider upload cap', async () => {
    const audioPath = await realAudioFile('big.mp3', 2048);
    const id = insertLesson(db, { audioPath });
    const outcome = await transcribeNextPending(db, async () => RESULT, 1024);
    expect(outcome.state).toBe('failed');
    expect(lessonRow(db, id).transcriptionError).toContain('upload cap');
  });
});

describe('worker gate', () => {
  test('does not start unless TRANSCRIBE_WORKER=1', () => {
    const previous = process.env.TRANSCRIBE_WORKER;
    delete process.env.TRANSCRIBE_WORKER;
    try {
      expect(startTranscribeWorker()).toBe(false);
    } finally {
      if (previous !== undefined) process.env.TRANSCRIBE_WORKER = previous;
    }
  });
});
