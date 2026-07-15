// Disk storage helpers for uploaded lesson audio (#185): one file per lesson
// under AUDIO_DIR (never SQLite). Shared by the import route (write), the
// audio-serving route (content type), and the lesson/collection delete routes
// (cleanup — SQLite can't cascade a file).

import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { AUDIO_DIR } from '../db';

// Containers <audio> can play and Whisper backends accept. Keys are the
// canonical stored extension; the content type serves both range requests and
// the ASR multipart part.
const AUDIO_CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
};

/** The upload's extension, lowercased, when it's a supported audio container; null otherwise. */
export function allowedAudioExtension(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  return ext in AUDIO_CONTENT_TYPES ? ext : null;
}

export function audioContentType(filePath: string): string {
  return AUDIO_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function audioPathForLesson(lessonId: string, extension: string): string {
  return path.join(AUDIO_DIR, `${lessonId}${extension}`);
}

/** Atomic tmp-write + rename (the tts-cache idiom) so a crash mid-write never
 * leaves a half file where the transcription job will look for it. */
export async function saveAudioFile(destPath: string, data: ArrayBuffer): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.${randomUUID()}.tmp`;
  await Bun.write(tmpPath, data);
  fs.renameSync(tmpPath, destPath);
}

/**
 * Best-effort unlink for a lesson's audio on delete. Refuses paths outside
 * AUDIO_DIR — audioPath comes from the DB, and a tampered/restored row must
 * never turn a lesson delete into an arbitrary-file delete.
 */
export function deleteAudioFile(audioPath: string | null | undefined): void {
  if (!audioPath) return;
  const resolved = path.resolve(audioPath);
  if (!resolved.startsWith(path.resolve(AUDIO_DIR) + path.sep)) return;
  try {
    fs.unlinkSync(resolved);
  } catch {
    /* already gone */
  }
}
