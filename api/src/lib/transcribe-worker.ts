// Background audio→transcript worker (#185). Runs an in-process drain loop in
// the HONO PROCESS ONLY (it owns the DB and the ASR provider) — modeled on
// classify-worker.ts. Boots only when TRANSCRIBE_WORKER=1, so it stays off
// under test/e2e and in any process that doesn't opt in.
//
// Restart-safe: the to-do list is `transcriptionStatus = 'pending'` rows in
// the lessons table, and a boot-time janitor resets stale 'processing' rows
// (a crash or laptop sleep mid-job) back to 'pending', so a restart simply
// resumes. One lesson drains per tick — transcription is minutes-long, so
// there is nothing to gain from concurrency against a single ASR server.
//
// The DB-touching functions take a `Database` argument (the codebase idiom for
// testable db code, cf. classify-worker) so unit tests drive them against an
// in-memory DB with an injected transcriber — no real ASR server, no real DB.

import { Database } from 'bun:sqlite';
import { db } from '../db';
import { countWords } from './html-to-markdown';
import { normalizeText } from './languages';
import {
  getTranscriptionProvider,
  type TranscribeOptions,
  type TranscriptionResult,
} from './transcription';
import { Sentry } from './sentry';

/** Lesson rows a drain tick operates on. */
export interface PendingTranscription {
  userId: string;
  id: string;
  language: string;
  audioPath: string;
  audioDurationMs: number | null;
  transcriptionAttempts: number;
}

/** Attempts include the one being made — 3 means "fail for good on the 3rd". */
const MAX_ATTEMPTS = 3;

/** Sentences per reading-mode paragraph. Whisper segments are utterance/sentence
 * sized; grouping a handful per paragraph reads like prose instead of one wall
 * of text or one line per sentence. */
const SENTENCES_PER_PARAGRAPH = 5;

/**
 * The transcript that becomes the lesson's textContent — a normal markdown
 * lesson (reading mode is free). Built from the segments so reading and
 * listen-along agree on the text; falls back to the provider's flat text when
 * a backend returns no timestamps.
 */
export function transcriptMarkdown(result: TranscriptionResult): string {
  if (result.segments.length === 0) return normalizeText(result.text);
  const paragraphs: string[] = [];
  for (let i = 0; i < result.segments.length; i += SENTENCES_PER_PARAGRAPH) {
    paragraphs.push(
      result.segments
        .slice(i, i + SENTENCES_PER_PARAGRAPH)
        .map((s) => s.text)
        .join(' '),
    );
  }
  return normalizeText(paragraphs.join('\n\n'));
}

/** A real speaker repeats a line at most a couple of times in a row; more is
 * the decoder looping. */
const MAX_CONSECUTIVE_REPEATS = 2;

/**
 * Collapse Whisper repetition loops: on non-speech stretches (music, long
 * silence) the decoder re-emits its last hypothesis over and over, yielding
 * runs of a dozen identical segments. Keep at most two consecutive copies and
 * drop the rest — the dropped span simply keeps the previous line highlighted
 * during playback, which is what that stretch of audio actually is. Applies
 * to any backend (local whisper.cpp, Speaches, Groq); server-side VAD reduces
 * the artifact but can't be assumed.
 */
export function collapseRepeatedSegments(
  segments: TranscriptionResult['segments'],
): TranscriptionResult['segments'] {
  const kept: TranscriptionResult['segments'] = [];
  let run = 0;
  for (const segment of segments) {
    const previous = kept[kept.length - 1];
    run = previous && previous.text.trim() === segment.text.trim() ? run + 1 : 1;
    if (run <= MAX_CONSECUTIVE_REPEATS) kept.push(segment);
  }
  return kept;
}

/**
 * Boot-time janitor: any lesson stuck in 'processing' was orphaned by a crash
 * or sleep mid-job — reset it so the loop picks it up again. Its attempt was
 * already counted at claim time, so a crash-looping file still caps out.
 */
export function resetStaleTranscriptions(database: Database): number {
  return database
    .prepare(
      "UPDATE lessons SET transcriptionStatus = 'pending' WHERE transcriptionStatus = 'processing'",
    )
    .run().changes;
}

/** Oldest pending audio lesson across every tenant (the worker has no request context). */
export function selectNextPending(database: Database): PendingTranscription | null {
  return (
    (database
      .prepare(
        `SELECT userId, id, language, audioPath, audioDurationMs, transcriptionAttempts
           FROM lessons
          WHERE transcriptionStatus = 'pending' AND audioPath IS NOT NULL
          ORDER BY createdAt, id
          LIMIT 1`,
      )
      .get() as PendingTranscription | undefined) ?? null
  );
}

function markError(database: Database, row: PendingTranscription, message: string): void {
  database
    .prepare(
      "UPDATE lessons SET transcriptionStatus = 'error', transcriptionError = ? WHERE userId = ? AND id = ?",
    )
    .run(message.slice(0, 500), row.userId, row.id);
}

/**
 * Write the finished transcript in one transaction: segments are replaced
 * wholesale (idempotent under retry), textContent/wordCount make it a normal
 * readable lesson, and the ffprobe duration is backfilled from the ASR
 * response when the upload-time probe couldn't supply one.
 */
export function applyTranscript(
  database: Database,
  row: PendingTranscription,
  rawResult: TranscriptionResult,
): void {
  const result: TranscriptionResult = {
    ...rawResult,
    segments: collapseRepeatedSegments(rawResult.segments),
  };
  const text = transcriptMarkdown(result);
  const insertSegment = database.prepare(
    'INSERT INTO transcript_segments (userId, lessonId, idx, startMs, endMs, text) VALUES (?, ?, ?, ?, ?, ?)',
  );
  database.transaction(() => {
    database
      .prepare('DELETE FROM transcript_segments WHERE userId = ? AND lessonId = ?')
      .run(row.userId, row.id);
    for (let i = 0; i < result.segments.length; i++) {
      const segment = result.segments[i];
      insertSegment.run(
        row.userId,
        row.id,
        i,
        segment.startMs,
        segment.endMs,
        normalizeText(segment.text),
      );
    }
    database
      .prepare(
        `UPDATE lessons
            SET textContent = ?, wordCount = ?,
                audioDurationMs = COALESCE(audioDurationMs, ?),
                transcriptionStatus = 'done', transcriptionError = NULL
          WHERE userId = ? AND id = ?`,
      )
      .run(text, countWords(text), result.durationMs ?? null, row.userId, row.id);
  })();
}

export type DrainOutcome =
  | { state: 'idle' }
  | { state: 'done'; lessonId: string; segments: number }
  | { state: 'retrying'; lessonId: string; error: string }
  | { state: 'failed'; lessonId: string; error: string };

/**
 * One drain step: claim the oldest pending lesson, transcribe its audio, and
 * write the transcript back. `transcribe` is injectable so tests can stub the
 * ASR call; `maxBytes` mirrors the provider's upload cap.
 */
export async function transcribeNextPending(
  database: Database,
  transcribe: (audio: Blob, options: TranscribeOptions) => Promise<TranscriptionResult>,
  maxBytes?: number,
): Promise<DrainOutcome> {
  const row = selectNextPending(database);
  if (!row) return { state: 'idle' };

  // Claim — the attempt counter increments here so a crash mid-job (janitor
  // reset) still counts toward the cap.
  const claimed = database
    .prepare(
      `UPDATE lessons
          SET transcriptionStatus = 'processing', transcriptionAttempts = transcriptionAttempts + 1
        WHERE userId = ? AND id = ? AND transcriptionStatus = 'pending'`,
    )
    .run(row.userId, row.id).changes;
  if (claimed === 0) return { state: 'idle' };
  const attempt = row.transcriptionAttempts + 1;

  const file = Bun.file(row.audioPath);
  if (!(await file.exists())) {
    // No file will ever appear — retrying is pointless.
    markError(database, row, 'Audio file is missing on disk');
    return { state: 'failed', lessonId: row.id, error: 'Audio file is missing on disk' };
  }
  if (maxBytes && file.size > maxBytes) {
    const message = `Audio file (${Math.round(file.size / 1024 / 1024)} MB) exceeds the ASR provider's ${Math.round(maxBytes / 1024 / 1024)} MB upload cap — re-encode it smaller (e.g. mono 48 kbps opus) or point ASR_URL at a local Whisper server`;
    markError(database, row, message);
    return { state: 'failed', lessonId: row.id, error: message };
  }

  try {
    const result = await transcribe(file, {
      language: row.language,
      filename: row.audioPath.split('/').pop() || 'audio',
    });
    applyTranscript(database, row, result);
    return { state: 'done', lessonId: row.id, segments: result.segments.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (attempt >= MAX_ATTEMPTS) {
      markError(database, row, message);
      return { state: 'failed', lessonId: row.id, error: message };
    }
    database
      .prepare(
        "UPDATE lessons SET transcriptionStatus = 'pending', transcriptionError = ? WHERE userId = ? AND id = ?",
      )
      .run(message.slice(0, 500), row.userId, row.id);
    return { state: 'retrying', lessonId: row.id, error: message };
  }
}

/** True when this process is configured to run the transcription loop. */
export function transcribeWorkerEnabled(): boolean {
  return process.env.TRANSCRIBE_WORKER === '1';
}

let loopTimer: ReturnType<typeof setInterval> | null = null;
let kickTimer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;

/**
 * Boot the drain loop (Hono process only). No-op unless TRANSCRIBE_WORKER=1.
 * Returns whether it actually started, so callers/tests can assert the gate.
 * The tick interval only controls how quickly a NEW upload is noticed — a
 * running transcription holds the tick (`ticking`) for its whole duration, and
 * because the job's request is what triggers a scale-to-zero Whisper server's
 * model load, cold-start latency is invisible here.
 */
export function startTranscribeWorker(): boolean {
  if (!transcribeWorkerEnabled()) return false;
  if (loopTimer) return true; // already running

  const intervalMs = Math.max(
    1000,
    parseInt(process.env.TRANSCRIBE_INTERVAL_MS || '15000', 10) || 15000,
  );

  resetStaleTranscriptions(db);

  const tick = async () => {
    if (ticking) return; // never overlap a slow ASR call
    ticking = true;
    try {
      // Each drain is its own root trace (no inbound request) — same rationale
      // as classify-worker: failures surface in Sentry instead of being
      // swallowed as console lines.
      await Sentry.startSpan({ name: 'transcribe-worker.tick', op: 'queue.process' }, async () => {
        // Resolved per tick, not at boot, so env-driven provider changes don't
        // require a restart mid-queue.
        const provider = getTranscriptionProvider();
        const outcome = await transcribeNextPending(
          db,
          (audio, options) => provider.transcribe(audio, options),
          provider.maxBytes,
        );
        if (outcome.state === 'done') {
          console.log(
            `[transcribe-worker] transcribed lesson ${outcome.lessonId} (${outcome.segments} segments)`,
          );
        } else if (outcome.state === 'retrying') {
          console.warn(
            `[transcribe-worker] lesson ${outcome.lessonId} failed (${outcome.error}) — will retry`,
          );
        } else if (outcome.state === 'failed') {
          console.warn(
            `[transcribe-worker] lesson ${outcome.lessonId} failed for good: ${outcome.error}`,
          );
        }
      });
    } catch (err) {
      Sentry.captureException(err);
      console.error('[transcribe-worker] tick failed:', err);
    } finally {
      ticking = false;
    }
  };

  loopTimer = setInterval(tick, intervalMs);
  loopTimer.unref?.();
  // First drain shortly after boot, without blocking startup.
  kickTimer = setTimeout(tick, 1000);
  kickTimer.unref?.();
  console.log(`[transcribe-worker] enabled (every ${intervalMs}ms)`);
  return true;
}

/** Stop the loop and cancel any pending first-drain kick (tests / shutdown). */
export function stopTranscribeWorker(): void {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  if (kickTimer) {
    clearTimeout(kickTimer);
    kickTimer = null;
  }
}
