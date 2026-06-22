'use client';

import { AudioLines, Check, ChevronRight, Eye, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { isTTSAvailable } from '@/lib/tts';
import type { DictationResult, DictationWord } from '../../types';

const masteryLabels: Record<number, string> = {
  0: 'New',
  25: 'Learning',
  50: 'Familiar',
  75: 'Almost There',
  100: 'Mastered',
};

// One word of the diff. Correct words read green; a word the user got wrong is
// struck through in red, and a word they missed entirely is underlined in red.
function DiffWord({ word }: { word: DictationWord }) {
  if (word.status === 'correct') {
    return <span className="text-primary">{word.text}</span>;
  }
  if (word.status === 'wrong') {
    return <span className="text-destructive line-through">{word.text}</span>;
  }
  return (
    <span className="text-destructive underline decoration-dotted underline-offset-4">
      {word.text}
    </span>
  );
}

function DiffLine({ words }: { words: DictationWord[] }) {
  if (words.length === 0) {
    return <span className="text-muted-foreground italic">(nothing typed)</span>;
  }
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <DiffWord word={w} />
        </span>
      ))}
    </>
  );
}

// Dictation result screen: how the typed sentence lined up against the audio,
// the accuracy, the SRS mastery change, and a replay. Mirrors ClozeFeedback's
// look so the two practice formats feel like one app.
export default function DictationFeedback({
  result,
  translation,
  onNext,
  onSpeak,
}: {
  result: DictationResult;
  translation: string;
  onNext: () => void;
  onSpeak: () => void;
}) {
  const { diff, isPass, isPerfect, surrendered, points, newMastery, previousMastery } = result;
  const accuracyPct = Math.round(diff.accuracy * 100);
  const masteryChange = newMastery - previousMastery;

  // Visual tone: a pass is green, a genuine miss is red, and a surrender is
  // neutral — the learner chose to reveal the answer, so it's still a miss for
  // the SRS card but isn't framed as "wrong".
  const tone: 'pass' | 'fail' | 'neutral' = surrendered ? 'neutral' : isPass ? 'pass' : 'fail';
  const cardClass = {
    pass: 'border-primary bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))]',
    fail: 'border-destructive bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))]',
    neutral: 'border-border bg-card',
  }[tone];
  const iconCircle = {
    pass: 'bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] text-primary',
    fail: 'bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] text-destructive',
    neutral: 'bg-muted text-foreground',
  }[tone];
  const accentText = { pass: 'text-primary', fail: 'text-destructive', neutral: 'text-foreground' }[
    tone
  ];
  const barClass = { pass: 'bg-primary', fail: 'bg-destructive', neutral: 'bg-muted-foreground' }[
    tone
  ];
  const heading = surrendered
    ? 'Answer revealed'
    : isPerfect
      ? 'Perfect!'
      : isPass
        ? 'Correct!'
        : 'Incorrect';

  return (
    <div className={`rounded-xl border-2 p-6 transition-all ${cardClass}`}>
      {/* Result header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${iconCircle}`}>
            {tone === 'pass' ? (
              <Check className="h-6 w-6" />
            ) : tone === 'fail' ? (
              <X className="h-6 w-6" />
            ) : (
              <Eye className="h-6 w-6" />
            )}
          </div>
          <div>
            <h3 className={`text-xl font-bold ${accentText}`}>{heading}</h3>
            <p
              className="text-sm font-medium text-muted-foreground"
              data-testid="dictation-accuracy"
            >
              {accuracyPct}% correct ({diff.correctWords}/{diff.totalWords} words)
              {isPass && points > 0 && (
                <span className="text-[var(--gold-strong)]"> · +{points} points</span>
              )}
            </p>
          </div>
        </div>
        {isTTSAvailable() && (
          <Button type="button" onClick={onSpeak} variant="ghost">
            <AudioLines className="h-4 w-4" />
            Listen Again
          </Button>
        )}
      </div>

      {/* What the user typed */}
      <div className="mb-3">
        <p className="mb-1 text-sm font-medium text-muted-foreground">You typed</p>
        <p className="text-lg leading-relaxed font-medium">
          <DiffLine words={diff.typed} />
        </p>
      </div>

      {/* The actual sentence (now revealed) */}
      <div className="mb-4">
        <p className="mb-1 text-sm font-medium text-muted-foreground">Sentence</p>
        <p className="text-lg leading-relaxed font-medium" data-testid="dictation-actual">
          <DiffLine words={diff.expected} />
        </p>
      </div>

      {/* Translation */}
      <div className="mb-4 rounded-lg bg-muted p-3">
        <p className="text-sm font-medium text-muted-foreground">Translation</p>
        <p className="text-foreground">{translation}</p>
      </div>

      {/* Mastery progress */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">Mastery Level</span>
          <span className="flex items-center gap-2">
            <span className={`font-semibold ${accentText}`}>{masteryLabels[newMastery]}</span>
            {masteryChange !== 0 && (
              <span
                className={`text-xs font-bold ${
                  masteryChange > 0 ? 'text-primary' : 'text-destructive'
                }`}
              >
                {masteryChange > 0 ? '+' : ''}
                {masteryChange}%
              </span>
            )}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full transition-all duration-500 ${barClass}`}
            style={{ width: `${newMastery}%` }}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={onNext} className="flex-1">
          Next Sentence
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Keyboard hint */}
      <div className="mt-4 flex items-center justify-center text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Enter</Kbd>
          Next sentence
        </span>
      </div>
    </div>
  );
}
