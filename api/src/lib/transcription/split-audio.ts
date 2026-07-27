// ffmpeg-based audio splitting for oversized ASR uploads (#185).
//
// Hosted transcription endpoints cap a single request well below the size of a
// long recording — OpenRouter and OpenAI both stop at 25 MB, and OpenRouter's
// upstreams additionally time out after 60 s of processing. Neither cap can be
// raised by re-encoding a 100 MB file, so the only way to transcribe one over
// the ordinary multipart path is to cut it into sub-cap pieces, transcribe each
// piece, and stitch the transcripts back together on the original timeline.
//
// Cutting is a stream copy (`-c copy`): every audio frame is a keyframe, so the
// segment muxer can split on frame boundaries without re-encoding. That keeps
// the operation fast and lossless, and each piece keeps the source container so
// the ASR backend still sniffs the format from the extension.
//
// Subprocess-over-library follows the ffprobe precedent in ../audio-probe.ts.

import fs from 'fs';
import os from 'os';
import path from 'path';

export interface AudioChunk {
  /** Absolute path to the chunk file (inside the result's temp directory). */
  path: string;
  /** Where this chunk starts within the original recording. */
  startMs: number;
  /** Where it ends within the original recording. */
  endMs: number;
}

export interface SplitAudio {
  chunks: AudioChunk[];
  /** Delete the temp directory holding the chunks. Always call in a `finally`. */
  cleanup: () => void;
}

export type SplitAudioFn = (filePath: string, segmentSeconds: number) => Promise<SplitAudio>;

/**
 * ffmpeg's `-segment_list_type csv` writes one `name,start,end` line per piece,
 * with the real boundaries it landed on. Reading those back is what keeps the
 * stitched timeline exact — `index * segmentSeconds` would drift, because a
 * stream copy can only cut on a frame boundary near the requested time.
 */
function parseSegmentList(csv: string, outDir: string): AudioChunk[] {
  const chunks: AudioChunk[] = [];
  for (const line of csv.split('\n')) {
    const fields = line.trim().split(',');
    if (fields.length < 3) continue;
    const start = parseFloat(fields[fields.length - 2]);
    const end = parseFloat(fields[fields.length - 1]);
    const name = fields.slice(0, fields.length - 2).join(',');
    if (!name || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    chunks.push({
      path: path.join(outDir, path.basename(name)),
      startMs: Math.round(start * 1000),
      endMs: Math.round(end * 1000),
    });
  }
  return chunks;
}

/**
 * Split `filePath` into ~`segmentSeconds` pieces in a fresh temp directory.
 *
 * Throws (rather than returning the whole file) when ffmpeg is missing or the
 * cut fails: the caller only reaches here for a file that is already too big to
 * send in one request, so silently falling back would just trade this error for
 * the provider's less legible one.
 */
export async function splitAudio(filePath: string, segmentSeconds: number): Promise<SplitAudio> {
  const extension = path.extname(filePath) || '.mp3';
  // ffmpeg runs with cwd set to the output directory (so the segment list holds
  // bare filenames), which would otherwise resolve a relative AUDIO_DIR path
  // against the temp dir instead of ours.
  const input = path.resolve(filePath);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lector-asr-'));
  const cleanup = () => {
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* best effort — a leftover temp dir is not worth failing a transcript over */
    }
  };

  try {
    const listPath = path.join(outDir, 'segments.csv');
    const proc = Bun.spawn(
      [
        'ffmpeg',
        '-v',
        'error',
        '-i',
        input,
        // Cover art rides along as a video stream in tagged mp3/m4a; the segment
        // muxer refuses it, and the ASR backend has no use for it either.
        '-map',
        '0:a',
        '-c',
        'copy',
        '-f',
        'segment',
        '-segment_time',
        String(segmentSeconds),
        '-segment_list',
        listPath,
        '-segment_list_type',
        'csv',
        // Each piece starts its own clock at zero, so the ASR timestamps are
        // chunk-relative and the caller adds `startMs` uniformly.
        '-reset_timestamps',
        '1',
        `chunk_%04d${extension}`,
      ],
      { cwd: outDir, stdout: 'ignore', stderr: 'pipe' },
    );
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    if (proc.exitCode !== 0) {
      throw new Error(`ffmpeg could not split the audio: ${stderr.trim().slice(0, 300)}`);
    }

    const chunks = parseSegmentList(fs.readFileSync(listPath, 'utf8'), outDir).filter((chunk) =>
      fs.existsSync(chunk.path),
    );
    if (chunks.length === 0) {
      throw new Error('ffmpeg produced no audio chunks');
    }
    return { chunks, cleanup };
  } catch (err) {
    cleanup();
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new Error('ffmpeg is required to transcribe audio above the provider upload cap');
    }
    throw err;
  }
}
