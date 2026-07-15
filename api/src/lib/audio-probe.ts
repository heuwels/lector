// ffprobe duration probe for uploaded lesson audio (#185). Best-effort: a
// missing ffprobe binary or an unreadable file yields null rather than failing
// the upload — the transcription job backfills the duration from the ASR
// response (`verbose_json.duration`) when the probe couldn't supply one.
// Subprocess-over-library follows the espeak-ng precedent in routes/tts.ts.

/**
 * Whole minutes reserved against audioTranscriptionMinutesPerMonth (#185).
 * From the probed duration when ffprobe supplied one; otherwise estimated
 * from file size at ~1 MiB per minute (128 kbps stereo). Higher-bitrate files
 * over-estimate, which errs on the metered side — a probe-less upload must
 * never be free. Always at least 1.
 */
export function estimateTranscriptionMinutes(durationMs: number | null, bytes: number): number {
  if (durationMs && durationMs > 0) return Math.max(1, Math.ceil(durationMs / 60_000));
  return Math.max(1, Math.ceil(bytes / (1024 * 1024)));
}

export async function probeAudioDurationMs(filePath: string): Promise<number | null> {
  try {
    const proc = Bun.spawn(
      ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { stdout: 'pipe', stderr: 'ignore' },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    if (proc.exitCode !== 0) return null;
    const seconds = parseFloat(output.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.round(seconds * 1000);
  } catch {
    return null;
  }
}
