'use client';

import { memo } from 'react';
import { Play } from 'lucide-react';
import type { LanguageConfig, WordSegmentation } from '@/lib/languages';
import { foldWord, lookupByVocabKeys } from '@/lib/languages';
import type { TranscriptSegment, WordState } from '@/types';
import type { WordSource } from './types';
import type { ActiveReaderWord } from './ReaderArticle';
import { collectWords, computePhraseHighlightSet, splitWords } from './utils';
import { wordReading, type AnnotationMode } from './annotation';
import { readerWrapClass } from './wrap';
import WordCell from '@/components/WordCell';

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
  /**
   * The lesson's stored segmentation (#289 4.2). A YouTube lesson's
   * `segmentWords` is built from the flattened transcript, which is exactly the
   * text of these cues, so the vocabulary covers them.
   */
  segmentation: WordSegmentation | null;
  knownWordsMap: Map<string, WordState>;
  /** Folded word -> pronunciation for the ruby layer (#289 4.4). */
  readings: Map<string, string> | null;
  annotationMode: AnnotationMode;
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
  segmentation,
  knownWordsMap,
  readings,
  annotationMode,
  highlightedPhrase,
  activeWord,
  activeSegmentIndex,
  onWordClick,
  onActivateWord,
  onClearPhrase,
  onSeek,
}: TranscriptReaderProps) {
  // Whether the reading sits out of flow above the word, or in the line box
  // where ruby layout widens the word to fit it. See `annotationOverhang`.
  const overhangs = pack.pronunciation.annotationOverhang;
  return (
    <div
      // See the note on the reader article: the glyph shapes follow the
      // lesson's language, not the interface language.
      lang={pack.script.bcp47}
      dir={pack.script.direction}
      className={`mx-auto max-w-[46em] px-4 py-6 text-foreground sm:px-8 sm:py-8 ${readerWrapClass(pack)}`}
      data-testid="transcript-reader"
    >
      {segments.map((segment, segmentIndex) => {
        const words = collectWords(segment.text, pack, segmentation);
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
            <p
              className={`flex-1 text-lg sm:text-xl ${
                annotationMode !== 'off' && readings !== null
                  ? overhangs
                    ? 'leading-[2.15]'
                    : 'leading-[2.7]'
                  : 'leading-[1.9]'
              }`}
            >
              {splitWords(segment.text, pack, segmentation).map((part, partIndex) => {
                if (!part.isWord) {
                  return (
                    <span key={partIndex} data-leaf="">
                      {part.text}
                    </span>
                  );
                }
                wordIndex += 1;
                const thisIndex = wordIndex;
                const key = foldWord(part.text, pack);
                const state = lookupByVocabKeys(knownWordsMap, part.text, pack);
                return (
                  <WordCell
                    key={partIndex}
                    text={part.text}
                    state={state}
                    isActive={
                      activeWord?.blockId === segmentIndex && activeWord.wordIndex === thisIndex
                    }
                    isPhraseHighlighted={phraseSet.has(thisIndex)}
                    reading={wordReading(annotationMode, readings, key, state)}
                    readingOverhangs={overhangs}
                    onActivate={() => {
                      onClearPhrase();
                      onActivateWord({ blockId: segmentIndex, wordIndex: thisIndex });
                      onWordClick(part.text, segment.text, source);
                    }}
                  />
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
