'use client';

import { memo } from 'react';
import { Play } from 'lucide-react';
import type { LanguageConfig } from '@/lib/languages';
import { foldWord } from '@/lib/languages';
import type { TranscriptSegment, WordState } from '@/types';
import type { WordSource } from './types';
import type { ActiveReaderWord } from './ReaderArticle';
import { collectWords, computePhraseHighlightSet, splitWords } from './utils';
import { stateClasses } from './theme';

/** mm:ss / h:mm:ss label for a second offset (mirrors the server helper). */
function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

interface TranscriptReaderProps {
  segments: TranscriptSegment[];
  sourceUrl: string;
  pack: LanguageConfig;
  knownWordsMap: Map<string, WordState>;
  highlightedPhrase: string[];
  activeWord: ActiveReaderWord | null;
  activeSegmentIndex: number | null;
  onWordClick: (word: string, sentence: string, source?: WordSource) => void;
  onActivateWord: (word: ActiveReaderWord) => void;
  onClearPhrase: () => void;
  onSeek: (seconds: number, segmentIndex: number) => void;
}

/**
 * Renders a timestamped transcript. Each cue is one row: a clickable timestamp
 * (seeks the player) plus the cue's words, rendered with the exact same word
 * machinery as the markdown reader (splitWords + foldWord + stateClasses), so
 * known/unknown states, the translation drawer, and vocab actions all work
 * unchanged. `blockId` is the segment index — the same "exact instance clicked"
 * highlight the markdown reader uses per block.
 */
function TranscriptReader({
  segments,
  sourceUrl,
  pack,
  knownWordsMap,
  highlightedPhrase,
  activeWord,
  activeSegmentIndex,
  onWordClick,
  onActivateWord,
  onClearPhrase,
  onSeek,
}: TranscriptReaderProps) {
  return (
    <div
      className="mx-auto max-w-[46em] px-4 py-6 text-foreground sm:px-8 sm:py-8"
      data-testid="transcript-reader"
    >
      {segments.map((segment, segmentIndex) => {
        const words = collectWords(segment.text, pack);
        const phraseSet = computePhraseHighlightSet(words, highlightedPhrase, pack);
        const source: WordSource = {
          sourceUrl,
          startMs: Math.round(segment.start * 1000),
          endMs: Math.round(segment.end * 1000),
        };

        let wordIndex = -1;
        return (
          <div
            key={segmentIndex}
            data-testid="transcript-segment"
            data-segment-index={segmentIndex}
            data-active-segment={activeSegmentIndex === segmentIndex || undefined}
            className={`group flex gap-3 rounded-lg px-2 py-1.5 transition-colors sm:gap-4 ${
              activeSegmentIndex === segmentIndex
                ? 'bg-[color-mix(in_srgb,var(--clay)_12%,transparent)]'
                : ''
            }`}
          >
            <button
              type="button"
              data-testid="transcript-timestamp"
              onClick={() => onSeek(segment.start, segmentIndex)}
              title="Play from here"
              aria-label={`Play from ${formatTimestamp(segment.start)}`}
              className="mt-1 flex h-fit shrink-0 items-center gap-1 rounded-md px-2 py-1 font-mono text-xs text-muted-foreground tabular-nums transition-colors hover:bg-accent hover:text-foreground"
            >
              <Play className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
              {formatTimestamp(segment.start)}
            </button>
            {/* <p> so the reader's drag-select phrase lookup (closest('p')) works. */}
            <p className="flex-1 text-lg leading-[1.9] sm:text-xl">
              {splitWords(segment.text, pack).map((part, partIndex) => {
                if (!part.isWord) {
                  return (
                    <span key={partIndex} data-leaf="">
                      {part.text}
                    </span>
                  );
                }
                wordIndex += 1;
                const thisIndex = wordIndex;
                const state = knownWordsMap.get(foldWord(part.text, pack));
                const colorClass = state ? stateClasses[state] : stateClasses.new;
                const isPhraseHighlighted = phraseSet.has(thisIndex);
                const isActiveWord =
                  activeWord?.blockId === segmentIndex && activeWord.wordIndex === thisIndex;
                const isHighlighted = isPhraseHighlighted || isActiveWord;
                return (
                  <span
                    key={partIndex}
                    data-leaf=""
                    data-testid="reader-word"
                    data-word-state={state ?? 'new'}
                    role="button"
                    tabIndex={0}
                    aria-label={`Look up ${part.text}`}
                    onClick={() => {
                      onClearPhrase();
                      onActivateWord({ blockId: segmentIndex, wordIndex: thisIndex });
                      onWordClick(part.text, segment.text, source);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onClearPhrase();
                      onActivateWord({ blockId: segmentIndex, wordIndex: thisIndex });
                      onWordClick(part.text, segment.text, source);
                    }}
                    data-phrase-highlighted={isPhraseHighlighted || undefined}
                    data-active-word={isActiveWord || undefined}
                    className={`cursor-pointer rounded-[7px] px-[7px] font-bold hover:ring-2 hover:ring-ring/50 ${colorClass} ${isActiveWord ? 'ring-2 ring-[var(--clay)]' : ''}`}
                    style={
                      isHighlighted
                        ? { backgroundColor: 'color-mix(in srgb, var(--clay) 22%, transparent)' }
                        : undefined
                    }
                  >
                    {part.text}
                  </span>
                );
              })}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export default memo(TranscriptReader);
