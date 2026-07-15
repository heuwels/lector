'use client';

// Listen-along player for audio-backed lessons (#185): the lesson's audio +
// its timestamped transcript segments, with the reader's word-state coloring
// (shared <WordCell>). Two sub-modes over one transport:
//
// - Continuous (default): flowing playback with scrub/seek; the spoken
//   sentence highlights as the audio plays.
// - Shadow: the stepped drill of #39 over the real recording — one sentence
//   plays and auto-pauses so the learner repeats it aloud (honour system),
//   with Repeat / Prev / Next / speed. #39's Split step needs word-level
//   timepoints and ships later.
//
// Tapping any word auto-pauses and opens the translation drawer via the same
// onWordClick contract MarkdownReader uses, so vocab actions work identically.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpenText,
  FastForward,
  Pause,
  Play,
  Repeat2,
  Rewind,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { Lesson, TranscriptSegment, WordState } from '@/types';
import { foldWord, getLanguageConfig, isValidLanguageCode } from '@/lib/languages';
import { useActiveLanguage } from '@/utils/hooks';
import { splitWords } from '@/components/MarkdownReader/utils';
import WordCell from '@/components/WordCell';
import { createAudioUnitPlayer, type UnitPlayer } from './drill-player';
import { activeSegmentIndex, formatClock, nextPlaybackRate } from './utils';

const SKIP_SECONDS = 5;

export interface ListenAlongProps {
  lesson: Lesson;
  segments: TranscriptSegment[];
  audioUrl: string;
  knownWordsMap: Map<string, WordState>;
  wordPanelOpen?: boolean;
  onWordClick: (word: string, sentence: string) => void;
  /** Back to reading mode. */
  onExit: () => void;
}

type PlayerMode = 'continuous' | 'shadow';

interface ActiveListenWord {
  segmentIdx: number;
  wordIndex: number;
}

export default function ListenAlong({
  lesson,
  segments,
  audioUrl,
  knownWordsMap,
  wordPanelOpen = false,
  onWordClick,
  onExit,
}: ListenAlongProps) {
  const activeLang = useActiveLanguage();
  // Tokenize by the LESSON's language, same rule as MarkdownReader.
  const pack =
    lesson.language && isValidLanguageCode(lesson.language)
      ? getLanguageConfig(lesson.language)
      : activeLang;

  const audioRef = useRef<HTMLAudioElement>(null);
  const unitPlayerRef = useRef<UnitPlayer | null>(null);
  const segmentRefs = useRef<Map<number, HTMLElement>>(new Map());

  const [mode, setMode] = useState<PlayerMode>('continuous');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [rate, setRate] = useState(1);
  const [activeWord, setActiveWord] = useState<ActiveListenWord | null>(null);
  // Shadow's own pointer: which sentence the drill is on. Continuous derives
  // the highlight from the playhead instead.
  const [shadowIdx, setShadowIdx] = useState(0);

  const durationMs =
    lesson.audioDurationMs ?? (segments.length ? segments[segments.length - 1].endMs : 0);
  const playheadIdx = useMemo(() => activeSegmentIndex(segments, currentMs), [segments, currentMs]);
  const activeIdx = mode === 'shadow' ? shadowIdx : playheadIdx;

  const unitPlayer = useCallback((): UnitPlayer | null => {
    if (!audioRef.current) return null;
    if (!unitPlayerRef.current) unitPlayerRef.current = createAudioUnitPlayer(audioRef.current);
    return unitPlayerRef.current;
  }, []);

  useEffect(() => () => unitPlayerRef.current?.dispose(), []);

  // Slowing down must time-stretch, not drop pitch.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.preservesPitch = true;
    audio.playbackRate = rate;
  }, [rate]);

  // Word ring highlight follows the drawer: cleared whenever it's closed,
  // like the reader. Derived, not an effect — no cascading render.
  const effectiveActiveWord = wordPanelOpen ? activeWord : null;

  // Keep the active sentence in view while playing.
  useEffect(() => {
    if (activeIdx < 0 || (!isPlaying && mode === 'continuous')) return;
    segmentRefs.current.get(activeIdx)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIdx, isPlaying, mode]);

  const playSegment = useCallback(
    (idx: number) => {
      const segment = segments[idx];
      if (!segment) return;
      unitPlayer()?.playUnit(segment.startMs, segment.endMs);
    },
    [segments, unitPlayer],
  );

  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      // Pausing manually also cancels a shadow unit's boundary poll.
      unitPlayer()?.stop();
      return;
    }
    if (mode === 'shadow') {
      playSegment(shadowIdx);
      return;
    }
    void audio.play().catch(() => {});
  }, [isPlaying, mode, playSegment, shadowIdx, unitPlayer]);

  const stepSentence = useCallback(
    (direction: -1 | 1) => {
      if (mode === 'shadow') {
        const next = Math.min(segments.length - 1, Math.max(0, shadowIdx + direction));
        setShadowIdx(next);
        playSegment(next);
        return;
      }
      const audio = audioRef.current;
      if (!audio) return;
      const target = Math.min(segments.length - 1, Math.max(0, playheadIdx + direction));
      const segment = segments[target];
      if (segment) audio.currentTime = segment.startMs / 1000;
    },
    [mode, playheadIdx, playSegment, segments, shadowIdx],
  );

  const skipSeconds = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, audio.currentTime + delta);
  }, []);

  const handleModeChange = useCallback(
    (next: PlayerMode) => {
      if (next === mode) return;
      unitPlayer()?.stop();
      if (next === 'shadow') {
        // Start the drill at the sentence the listener is on.
        setShadowIdx(Math.max(0, playheadIdx));
      }
      setMode(next);
    },
    [mode, playheadIdx, unitPlayer],
  );

  const handleWordTap = useCallback(
    (segment: TranscriptSegment, wordIndex: number, text: string) => {
      // Interacting with a word always pauses — the whole point is to stop and
      // look it up without losing the playhead.
      unitPlayer()?.stop();
      setActiveWord({ segmentIdx: segment.idx, wordIndex });
      onWordClick(text, segment.text);
    },
    [onWordClick, unitPlayer],
  );

  const handleSeek = (valueMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = valueMs / 1000;
    setCurrentMs(valueMs);
  };

  const transportButton =
    'flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40';

  return (
    <div className="flex h-full flex-col bg-card" data-testid="listen-along">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <button
          onClick={onExit}
          data-testid="listen-along-exit"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-accent"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="hidden sm:inline">Back</span>
        </button>
        <h1 className="mx-2 flex-1 truncate text-center text-sm font-medium text-foreground sm:text-lg">
          {lesson.title}
        </h1>
        <button
          onClick={onExit}
          title="Read as text"
          aria-label="Read as text"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"
        >
          <BookOpenText className="h-5 w-5" />
        </button>
      </header>

      {/* Segments */}
      <div className="flex-1 overflow-auto">
        <div
          className="mx-auto max-w-[38em] px-4 py-8 sm:px-8"
          style={{ fontFamily: 'var(--font-literata), Georgia, serif' }}
        >
          {segments.map((segment, idx) => {
            const isActive = idx === activeIdx;
            return (
              <p
                key={segment.idx}
                ref={(el) => {
                  if (el) segmentRefs.current.set(idx, el);
                  else segmentRefs.current.delete(idx);
                }}
                data-testid="listen-segment"
                data-active-segment={isActive || undefined}
                onClick={(event) => {
                  // Row tap (not on a word) jumps playback to this sentence.
                  if ((event.target as HTMLElement).closest('[data-testid="reader-word"]')) return;
                  if (mode === 'shadow') {
                    setShadowIdx(idx);
                    playSegment(idx);
                  } else {
                    handleSeek(segment.startMs);
                  }
                }}
                className={`my-1 cursor-pointer rounded-xl px-3 py-2 text-lg leading-[1.9] transition-colors sm:text-xl ${
                  isActive
                    ? 'bg-[color-mix(in_srgb,var(--clay)_12%,transparent)]'
                    : 'hover:bg-accent/50'
                }`}
              >
                {splitWords(segment.text, pack).map((part, partIndex) =>
                  part.isWord ? (
                    <WordCell
                      key={partIndex}
                      text={part.text}
                      state={knownWordsMap.get(foldWord(part.text, pack))}
                      isActive={
                        effectiveActiveWord?.segmentIdx === segment.idx &&
                        effectiveActiveWord.wordIndex === partIndex
                      }
                      onActivate={(text) => handleWordTap(segment, partIndex, text)}
                    />
                  ) : (
                    <span key={partIndex}>{part.text}</span>
                  ),
                )}
              </p>
            );
          })}
        </div>
      </div>

      {/* Transport */}
      <div className="border-t border-border bg-card px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-[38em]">
          {/* Mode toggle + progress */}
          <div className="flex items-center justify-between gap-2 py-1">
            <div className="flex rounded-lg border border-border p-0.5 text-xs">
              {(['continuous', 'shadow'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => handleModeChange(m)}
                  data-testid={`listen-mode-${m}`}
                  className={`rounded-md px-3 py-1.5 font-medium capitalize transition-colors ${
                    mode === m
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="text-xs text-muted-foreground" data-testid="listen-progress">
              {mode === 'shadow'
                ? `Sentence ${Math.min(shadowIdx + 1, segments.length)} of ${segments.length}`
                : `${formatClock(currentMs)} / ${formatClock(durationMs)}`}
            </div>
          </div>

          {/* Scrubber (continuous only) */}
          {mode === 'continuous' && (
            <input
              type="range"
              min={0}
              max={Math.max(durationMs, 1)}
              value={Math.min(currentMs, durationMs)}
              onChange={(event) => handleSeek(Number(event.target.value))}
              aria-label="Seek"
              data-testid="listen-scrubber"
              className="w-full accent-[var(--clay)]"
            />
          )}

          {/* Controls */}
          <div className="flex items-center justify-center gap-1 sm:gap-2">
            <button
              onClick={() => setRate(nextPlaybackRate(rate))}
              title="Playback speed"
              data-testid="listen-speed"
              className="flex h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {rate}×
            </button>
            <button
              onClick={() => stepSentence(-1)}
              title="Previous sentence"
              aria-label="Previous sentence"
              data-testid="listen-prev-sentence"
              className={transportButton}
            >
              <SkipBack className="h-5 w-5" />
            </button>
            {mode === 'continuous' && (
              <button
                onClick={() => skipSeconds(-SKIP_SECONDS)}
                title={`Back ${SKIP_SECONDS} seconds`}
                aria-label={`Back ${SKIP_SECONDS} seconds`}
                className={transportButton}
              >
                <Rewind className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={handlePlayPause}
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              data-testid="listen-play-pause"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="ml-0.5 h-6 w-6" />}
            </button>
            {mode === 'continuous' ? (
              <button
                onClick={() => skipSeconds(SKIP_SECONDS)}
                title={`Forward ${SKIP_SECONDS} seconds`}
                aria-label={`Forward ${SKIP_SECONDS} seconds`}
                className={transportButton}
              >
                <FastForward className="h-5 w-5" />
              </button>
            ) : (
              <button
                onClick={() => playSegment(shadowIdx)}
                title="Repeat sentence"
                aria-label="Repeat sentence"
                data-testid="listen-repeat"
                className={transportButton}
              >
                <Repeat2 className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={() => stepSentence(1)}
              title="Next sentence"
              aria-label="Next sentence"
              data-testid="listen-next-sentence"
              className={transportButton}
            >
              <SkipForward className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => setCurrentMs(Math.round(event.currentTarget.currentTime * 1000))}
        data-testid="listen-audio"
      />
    </div>
  );
}
