// The shadowing drill seam (#39 / #185). Issue #39 owns the stepped
// repeat-until-comfortable drill; listen-along's Shadow sub-mode is that drill
// over a real recording. #39 hadn't landed when this shipped, so the seam is
// defined here exactly as #39 specifies it: a source-agnostic unit player —
// the drill logic never knows whether audio comes from a file, TTS, or
// anything else. When #39 lands, its TTS path implements this same interface
// and the drill controller moves up to a shared home.

export interface UnitPlayer {
  /**
   * Play one bounded unit: seek to startMs, play, auto-pause at endMs.
   * Replaces any in-flight unit.
   */
  playUnit(startMs: number, endMs: number): void;
  /** Pause without losing the element's position. */
  stop(): void;
  /** Release timers; the player must not touch the audio element afterwards. */
  dispose(): void;
}

/**
 * UnitPlayer over an HTMLAudioElement's time range. The end boundary is a
 * requestAnimationFrame poll, NOT a setTimeout: a timeout goes stale the
 * moment the user pauses, scrubs, or changes playbackRate mid-unit, while a
 * poll reads the element's real currentTime every frame (~16 ms granularity,
 * inaudible at sentence boundaries).
 */
export function createAudioUnitPlayer(audio: HTMLAudioElement): UnitPlayer {
  let raf: number | null = null;

  const cancelPoll = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  };

  return {
    playUnit(startMs: number, endMs: number) {
      cancelPoll();
      audio.currentTime = startMs / 1000;
      void audio.play().catch(() => {
        /* autoplay rejection — the user taps play again */
      });
      const poll = () => {
        if (audio.paused) {
          // User paused mid-unit; the unit is over.
          cancelPoll();
          return;
        }
        if (audio.currentTime * 1000 >= endMs) {
          audio.pause();
          cancelPoll();
          return;
        }
        raf = requestAnimationFrame(poll);
      };
      raf = requestAnimationFrame(poll);
    },
    stop() {
      cancelPoll();
      audio.pause();
    },
    dispose() {
      cancelPoll();
    },
  };
}
