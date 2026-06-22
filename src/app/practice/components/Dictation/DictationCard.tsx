'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioLines } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { DEFAULT_RATE, isTTSAvailable, speak } from '@/lib/tts';
import { DICTATION_MAX_REPLAYS, DICTATION_SPEEDS } from '../../constants';
import type { CurrentSentence } from '../../types';
import BlacklistSentence from '../BlacklistSentence';

// Dictation question card: the sentence is hidden and played as audio — the
// learner types back what they hear. Audio plays once on mount; "Listen Again"
// replays at the chosen speed up to DICTATION_MAX_REPLAYS times. The speed
// buttons only set the rate for the next replay (they don't play or count), so
// the replay budget stays predictable.
export default function DictationCard({
  current,
  onSubmit,
  onSurrender,
  onSentenceBlacklisted,
}: {
  current: CurrentSentence;
  onSubmit: (typed: string) => void;
  onSurrender: (typed: string) => void;
  onSentenceBlacklisted: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [speed, setSpeed] = useState<number>(DICTATION_SPEEDS[0]);
  const [replaysUsed, setReplaysUsed] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Guard so the once-per-sentence autoplay doesn't fire twice under React's
  // dev StrictMode double-invoke (and so changing speed never re-triggers it).
  const autoplayedFor = useRef<string | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sentence = current.sentence.sentence;
  const replaysLeft = DICTATION_MAX_REPLAYS - replaysUsed;
  const canReplay = replaysLeft > 0;

  // Drive the cosmetic "playing" pulse for roughly as long as the audio runs.
  const play = (rateMultiplier: number) => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    setIsPlaying(true);
    const wordCount = sentence.split(/\s+/).length;
    playTimerRef.current = setTimeout(
      () => setIsPlaying(false),
      Math.min(8000, 700 + wordCount * 350),
    );
    speak(sentence, DEFAULT_RATE * rateMultiplier);
  };

  // A user-initiated replay — costs one of the replay budget.
  const replay = () => {
    if (!canReplay) return;
    setReplaysUsed((n) => n + 1);
    play(speed);
  };

  // Autoplay once when the sentence changes, and focus the input. The initial
  // play is free (doesn't count against the replay budget).
  useEffect(() => {
    if (autoplayedFor.current !== current.sentence.id) {
      autoplayedFor.current = current.sentence.id;
      play(DICTATION_SPEEDS[0]);
    }
    inputRef.current?.focus();
    return () => {
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
    };
    // play/speed are intentionally excluded — this runs once per sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.sentence.id]);

  const handleSubmit = () => {
    if (!typed.trim()) return;
    onSubmit(typed.trim());
  };

  return (
    <div>
      <div className="mb-6">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Type the sentence you hear
          </span>
          <BlacklistSentence current={current} onSentenceBlacklisted={onSentenceBlacklisted} />
        </div>

        {/* Audio focus: a large speaker that replays on click */}
        <div className="flex flex-col items-center gap-4 py-4">
          <button
            type="button"
            onClick={replay}
            disabled={!canReplay || !isTTSAvailable()}
            aria-label="Replay audio"
            data-testid="dictation-replay-icon"
            className={`flex h-24 w-24 items-center justify-center rounded-full border-2 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
              isPlaying
                ? 'border-primary bg-[color-mix(in_srgb,var(--primary)_18%,var(--card))] text-primary'
                : 'border-[var(--clay)] bg-[color-mix(in_srgb,var(--clay)_12%,var(--card))] text-foreground hover:border-primary hover:text-primary'
            }`}
          >
            <AudioLines className={`h-12 w-12 ${isPlaying ? 'animate-pulse' : ''}`} />
          </button>

          {/* Speed control */}
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Speed</span>
            {DICTATION_SPEEDS.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={speed === s ? 'default' : 'secondary'}
                onClick={() => setSpeed(s)}
              >
                {s}x
              </Button>
            ))}
          </div>

          {/* Replay control with remaining budget */}
          <Button
            type="button"
            variant="ghost"
            onClick={replay}
            disabled={!canReplay || !isTTSAvailable()}
          >
            <AudioLines className="h-4 w-4" />
            {canReplay ? `Listen Again (${replaysLeft} left)` : 'No replays left'}
          </Button>
        </div>

        {/* Full-sentence answer */}
        <textarea
          ref={inputRef}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.repeat) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          rows={2}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Type what you hear…"
          data-testid="dictation-input"
          className="w-full resize-none rounded-lg border-2 border-[var(--clay)] bg-[color-mix(in_srgb,var(--clay)_8%,var(--card))] px-3 py-2 text-lg leading-relaxed text-foreground transition-all outline-none focus:border-primary focus:ring-2 focus:ring-ring focus:ring-offset-1"
        />
      </div>

      {/* Actions: give up and reveal the answer, or submit the attempt */}
      <div className="flex justify-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onSurrender(typed)}
          title="Reveal the sentence and move on (counts as a miss)"
        >
          Surrender
        </Button>
        <Button type="button" size="lg" onClick={handleSubmit} disabled={!typed.trim()}>
          Check
        </Button>
      </div>

      {/* Shortcut hint */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Enter</Kbd>
          Check
        </span>
      </div>

      {/* Mastery indicator */}
      <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <span>Mastery:</span>
        <div className="flex h-2 w-24 overflow-hidden rounded-full bg-muted">
          <div
            className="bg-primary transition-all"
            style={{ width: `${current.sentence.masteryLevel}%` }}
          />
        </div>
        <span>{current.sentence.masteryLevel}%</span>
      </div>
    </div>
  );
}
