'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WordState } from '@/types';
import { sentenceContainsWord } from '@/lib/words';
import { useActiveLanguage } from '@/utils/hooks';
import { TranslationDrawerProps } from './types';
import { wordStateColors, wordStateLabels } from './constants';
import { ChevronRight, RefreshCw, Sparkles, Volume2, X, Zap } from 'lucide-react';
import NestedWordButton from './components/NestedWordButton';
import Gloss from './components/Gloss';

export { type ExpandedDictionaryEntry } from './types';

export default function TranslationDrawer({
  isOpen,
  word,
  sentence,
  entry,
  aiTranslation,
  aiPartOfSpeech,
  aiContextTranslation,
  aiContextPartOfSpeech,
  aiPhraseDetails,
  isDictionaryResult,
  isLoading,
  isContextLoading,
  isStreaming,
  isEnriching,
  error,
  existingEntry,
  wordState,
  onboardingSaveProgress,
  onClose,
  onSpeak,
  onSetLevel,
  onMarkKnown,
  onIgnore,
  onRequestContextTranslation,
  onEnrich,
  onRetranslate,
  onLookupWord,
  onAddToAnki,
  onAddCloze,
}: TranslationDrawerProps) {
  const pack = useActiveLanguage();
  const drawerRef = useRef<HTMLDivElement>(null);
  const [relatedExpanded, setRelatedExpanded] = useState(false);
  // Anki push status for single-word cards
  const [ankiStatus, setAnkiStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  // Cloze picker state for phrase selections
  const [clozePickerOpen, setClozePickerOpen] = useState(false);
  const [clozeBlankWord, setClozeBlankWord] = useState<string | null>(null);
  const [clozeStatus, setClozeStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  // Reset the "show all related forms" toggle whenever the looked-up word
  // changes — uses React's adjusting-state-during-render pattern so we avoid
  // a setState-in-effect cascade.
  const [prevWord, setPrevWord] = useState(word);
  if (word !== prevWord) {
    setPrevWord(word);
    setRelatedExpanded(false);
    setAnkiStatus('idle');
    setClozePickerOpen(false);
    setClozeBlankWord(null);
    setClozeStatus('idle');
  }

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Click-outside-to-close intentionally omitted: it races with the
  // new-word click handler (mousedown closes the drawer before the click
  // fires on the new word). Users dismiss with Esc or the close button,
  // and clicking another word simply switches the drawer to that word.

  const handleSpeakWord = useCallback(() => onSpeak(word), [onSpeak, word]);
  const handleSpeakSentence = useCallback(() => onSpeak(sentence), [onSpeak, sentence]);

  const currentState = wordState ?? existingEntry?.state ?? 'new';
  const stateColors = wordStateColors[currentState];
  const isPhrase = word.includes(' ');
  // After a nested lookup (issue #106) the drawer keeps the sentence of the
  // word the user originally clicked — genuine provenance, but not context
  // for the current word unless it actually occurs in it ("sien" is not in
  // "Ek het die katte gesien"). Only offer the in-context AI translation
  // when it does.
  const wordOccursInSentence = !!sentence && sentenceContainsWord(sentence, word, pack);

  const senses = entry?.senses ?? [];
  const hasRichEntry = senses.length > 0;
  const fallbackTranslation = aiTranslation ?? null;

  const content = (
    <div
      data-testid="translation-drawer"
      aria-hidden={!isOpen}
      className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l border-border bg-popover shadow-2xl transition-transform duration-300 ease-out sm:w-96 print:hidden ${isOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full'} `}
      ref={drawerRef}
      role="dialog"
      aria-label={`Definition of ${word}`}
    >
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-muted/50 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${stateColors.dot}`}
                title={wordStateLabels[currentState]}
              />
              <h2 className="text-xl font-semibold break-words text-foreground">{word}</h2>
              <button
                onClick={handleSpeakWord}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Hear pronunciation"
                aria-label="Hear pronunciation"
              >
                <Volume2 className="h-5 w-5" />
              </button>
              {entry?.ipa && (
                <span className="font-mono text-sm text-muted-foreground">{entry.ipa}</span>
              )}
            </div>
            {entry?.lemmaInfo && (
              <p className="mt-1 text-xs text-muted-foreground">
                {entry.lemmaInfo.label}{' '}
                {onLookupWord ? (
                  <NestedWordButton
                    word={entry.lemmaInfo.stem}
                    onLookupWord={onLookupWord}
                    testId="lemma-stem-link"
                  />
                ) : (
                  <span className="font-medium text-foreground">{entry.lemmaInfo.stem}</span>
                )}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${stateColors.bg} ${stateColors.text}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${stateColors.dot}`} />
                {wordStateLabels[currentState]}
              </span>
              {/* Source attribution — always tells the user where the
                  currently-displayed translation came from. */}
              {aiContextTranslation ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--clay-soft)] px-2 py-0.5 text-xs font-medium text-[var(--clay)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--clay)]" />
                  AI · in context
                </span>
              ) : entry?.source === 'cache' ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--gold-soft)] px-2 py-0.5 text-xs font-medium text-[var(--gold-strong)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold-strong)]" />
                  learned
                </span>
              ) : isDictionaryResult ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--primary-soft)] px-2 py-0.5 text-xs font-medium text-[var(--primary-text)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  on-device
                </span>
              ) : (fallbackTranslation || aiPhraseDetails) && !isLoading ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                  AI
                </span>
              ) : null}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {/* Definition section */}
        <section className="border-b border-border px-4 py-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Looking up…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : aiContextTranslation ? (
            <div>
              <div>
                {aiContextPartOfSpeech && (
                  <span className="mr-2 inline-block rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {aiContextPartOfSpeech}
                  </span>
                )}
                <span className="leading-relaxed text-foreground">{aiContextTranslation}</span>
              </div>
              {hasRichEntry && (
                <details className="group mt-3">
                  <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                    Show dictionary ({senses.length})
                  </summary>
                  <ol className="mt-2 space-y-2">
                    {senses.map((sense, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="mt-0.5 flex-shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                          {i + 1}.
                        </span>
                        <div className="min-w-0 flex-1">
                          {sense.partOfSpeech && (
                            <span className="mr-2 inline-block rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                              {sense.partOfSpeech}
                            </span>
                          )}
                          <span className="text-foreground">
                            <Gloss text={sense.gloss} onLookupWord={onLookupWord} />
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          ) : hasRichEntry ? (
            <ol className="space-y-3">
              {senses.map((sense, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex-shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                    {i + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    {sense.partOfSpeech && (
                      <span className="mr-2 inline-block rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {sense.partOfSpeech}
                      </span>
                    )}
                    <span className="leading-relaxed text-foreground">
                      <Gloss text={sense.gloss} onLookupWord={onLookupWord} />
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : fallbackTranslation ? (
            <div>
              {aiPartOfSpeech && (
                <span className="mr-2 inline-block rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {aiPartOfSpeech}
                </span>
              )}
              <span className="leading-relaxed text-foreground">
                {fallbackTranslation}
                {isStreaming && (
                  <span
                    className="-mb-0.5 ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary"
                    aria-hidden="true"
                  />
                )}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No definition found.</p>
          )}

          {/* In-context AI button — always offered for single-word lookups so the
              user can ask the LLM to re-read the sentence and give a more nuanced
              translation than the bare dictionary gloss. */}
          {!isPhrase &&
            !isLoading &&
            !isContextLoading &&
            onRequestContextTranslation &&
            wordOccursInSentence && (
              <button
                onClick={onRequestContextTranslation}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[var(--clay-soft)] px-2.5 py-1 text-xs font-medium text-[var(--clay)] transition-colors hover:bg-[color-mix(in_srgb,var(--clay)_18%,transparent)]"
                title="Translate using AI with sentence context"
              >
                <Zap className="h-3 w-3" />
                In context
              </button>
            )}
          {isContextLoading && (
            <span className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--clay)]">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--clay)] border-t-transparent" />
              Asking AI…
            </span>
          )}

          {/* Enrich — upgrade a fast streamed gloss to the full dictionary entry
              (senses, IPA, etymology, related forms). Only offered for a bare AI
              gloss (the page passes onEnrich only when there's no rich entry yet). */}
          {onEnrich &&
            !isPhrase &&
            !isLoading &&
            !isStreaming &&
            !isContextLoading &&
            !isEnriching && (
              <button
                onClick={onEnrich}
                className="mt-3 ml-2 inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Add IPA, etymology, full senses & related forms"
              >
                <Sparkles className="h-3 w-3" />
                Enrich
              </button>
            )}
          {isEnriching && (
            <span className="mt-3 ml-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              Enriching…
            </span>
          )}
        </section>

        {/* Rich phrase details (idiom, literal breakdown, usage notes, register) */}
        {aiPhraseDetails &&
          (aiPhraseDetails.literalBreakdown ||
            aiPhraseDetails.idiomaticMeaning ||
            aiPhraseDetails.usageNotes ||
            aiPhraseDetails.register) && (
            <section className="space-y-3 border-b border-border px-4 py-3">
              {aiPhraseDetails.idiomaticMeaning && (
                <div>
                  <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Idiomatic meaning
                  </h3>
                  <p className="text-sm leading-relaxed text-foreground">
                    {aiPhraseDetails.idiomaticMeaning}
                  </p>
                </div>
              )}
              {aiPhraseDetails.literalBreakdown && (
                <div>
                  <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Literally
                  </h3>
                  <p className="text-sm leading-relaxed text-foreground italic">
                    {aiPhraseDetails.literalBreakdown}
                  </p>
                </div>
              )}
              {aiPhraseDetails.usageNotes && (
                <div>
                  <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Usage
                  </h3>
                  <p className="text-sm leading-relaxed text-foreground">
                    {aiPhraseDetails.usageNotes}
                  </p>
                </div>
              )}
              {aiPhraseDetails.register && aiPhraseDetails.register !== 'neutral' && (
                <div className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                  {aiPhraseDetails.register}
                </div>
              )}
            </section>
          )}

        {/* Etymology */}
        {entry?.etymology && (
          <section className="border-b border-border px-4 py-3">
            <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              Etymology
            </h3>
            <p className="text-sm leading-relaxed text-foreground">{entry.etymology}</p>
          </section>
        )}

        {/* Related forms — capped at 3 with expand toggle to keep the drawer
            from being flooded by polysemous words (e.g. "Dit" has ~20 forms). */}
        {entry?.relatedForms &&
          entry.relatedForms.length > 0 &&
          (() => {
            const total = entry.relatedForms.length;
            const COLLAPSED_COUNT = 3;
            const shown = relatedExpanded
              ? entry.relatedForms
              : entry.relatedForms.slice(0, COLLAPSED_COUNT);
            const hiddenCount = total - shown.length;
            return (
              <section className="border-b border-border px-4 py-3">
                <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Related forms
                </h3>
                <ul className="space-y-1">
                  {shown.map((r, i) => (
                    <li key={i} className="text-sm">
                      {onLookupWord ? (
                        <NestedWordButton
                          word={r.form}
                          onLookupWord={onLookupWord}
                          testId="related-form-link"
                        />
                      ) : (
                        <span className="font-medium text-foreground">{r.form}</span>
                      )}
                      <span className="ml-2 text-xs text-muted-foreground">{r.relation}</span>
                    </li>
                  ))}
                </ul>
                {total > COLLAPSED_COUNT && (
                  <button
                    onClick={() => setRelatedExpanded((v) => !v)}
                    className="mt-2 text-xs font-medium text-primary transition-colors hover:text-[var(--primary-text)]"
                  >
                    {relatedExpanded ? 'Show fewer' : `Show all (${total})`}
                    {!relatedExpanded && hiddenCount > 0 && (
                      <span className="ml-1 text-muted-foreground">+{hiddenCount}</span>
                    )}
                  </button>
                )}
              </section>
            );
          })()}

        {/* Sentence — only render if a sentence was provided */}
        {sentence && (
          <section className="border-b border-border px-4 py-3">
            <div className="flex items-start gap-2">
              <p className="flex-1 text-sm leading-relaxed text-muted-foreground italic">
                {sentence}
              </p>
              <button
                onClick={handleSpeakSentence}
                className="flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Hear sentence"
                aria-label="Hear sentence"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Footer — action buttons. */}
      {(onSetLevel || onMarkKnown || onIgnore || onRetranslate || onAddToAnki || onAddCloze) && (
        <div className="flex-shrink-0 space-y-2 border-t border-border bg-muted/50 px-4 py-3">
          {onboardingSaveProgress && (
            <div
              className="rounded-xl border border-[var(--gold-lip)] bg-[var(--gold-soft)] p-3"
              data-testid="onboarding-drawer-progress"
              role="status"
            >
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-foreground">
                  {onboardingSaveProgress.currentWordSaved
                    ? 'Added to your first review'
                    : 'Choose level 1–4 to add this word'}
                </span>
                <span className="shrink-0 font-bold text-[var(--gold-strong)]">
                  {Math.min(onboardingSaveProgress.savedCount, onboardingSaveProgress.target)}/
                  {onboardingSaveProgress.target} ready
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden="true">
                {Array.from({ length: onboardingSaveProgress.target }, (_, index) => (
                  <span
                    key={index}
                    className={`h-1.5 rounded-full transition-colors duration-300 ${
                      index < onboardingSaveProgress.savedCount ? 'bg-primary' : 'bg-border'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
          {(onSetLevel || onMarkKnown || onIgnore) && (
            <div className="flex flex-wrap items-center gap-2">
              {onSetLevel && (
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((level) => {
                    const stateKey = `level${level}` as WordState;
                    const isActive = currentState === stateKey;
                    const colors = wordStateColors[stateKey];
                    return (
                      <button
                        key={level}
                        onClick={() => onSetLevel(level as 1 | 2 | 3 | 4)}
                        data-testid={`word-level-${level}`}
                        aria-label={`Save at learning level ${level}`}
                        className={`h-9 w-9 rounded-lg text-sm font-semibold transition-all ${
                          isActive
                            ? `${colors.bg} ${colors.text} ring-2 ring-offset-1 ring-offset-popover ${colors.ring}`
                            : 'bg-muted text-muted-foreground hover:bg-accent'
                        }`}
                        title={`Level ${level}`}
                      >
                        {level}
                      </button>
                    );
                  })}
                </div>
              )}
              {onMarkKnown && (
                <button
                  onClick={onMarkKnown}
                  data-testid="mark-word-known"
                  className={`h-9 rounded-lg px-3 text-sm font-medium transition-colors ${
                    currentState === 'known'
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1 ring-offset-popover'
                      : 'bg-muted text-foreground hover:bg-[var(--primary-soft)] hover:text-[var(--primary-text)]'
                  }`}
                  title="Mark as known (K)"
                >
                  ✓ Known
                </button>
              )}
              {onIgnore && (
                <button
                  onClick={onIgnore}
                  data-testid="ignore-word"
                  className={`h-9 rounded-lg px-3 text-sm font-medium transition-colors ${
                    currentState === 'ignored'
                      ? 'bg-muted-foreground text-card ring-2 ring-muted-foreground ring-offset-1 ring-offset-popover'
                      : 'bg-muted text-foreground hover:bg-accent'
                  }`}
                  title="Ignore (X)"
                >
                  ✕ Ignore
                </button>
              )}
            </div>
          )}
          {onRetranslate && (
            <button
              onClick={onRetranslate}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Force fresh AI lookup (ignores dictionary)"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-translate with AI
            </button>
          )}
          {/* Anki — single word: pure word card */}
          {!isPhrase && onAddToAnki && (hasRichEntry || fallbackTranslation) && !isLoading && (
            <button
              data-testid="add-to-anki-btn"
              onClick={async () => {
                if (ankiStatus === 'loading' || ankiStatus === 'done') return;
                setAnkiStatus('loading');
                try {
                  await onAddToAnki();
                  setAnkiStatus('done');
                } catch {
                  setAnkiStatus('error');
                }
              }}
              disabled={ankiStatus === 'loading' || ankiStatus === 'done'}
              className={`flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                ankiStatus === 'done'
                  ? 'cursor-default border-primary/40 bg-primary/10 text-[var(--primary-text)]'
                  : ankiStatus === 'error'
                    ? 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {ankiStatus === 'done'
                ? '✓ Added to Anki'
                : ankiStatus === 'loading'
                  ? 'Adding…'
                  : ankiStatus === 'error'
                    ? 'Anki error — retry'
                    : 'Add to Anki'}
            </button>
          )}
          {/* Anki — phrase: cloze card with inline word picker */}
          {isPhrase && onAddCloze && (fallbackTranslation || aiPhraseDetails) && !isLoading && (
            <div data-testid="add-cloze-section">
              {!clozePickerOpen ? (
                <button
                  data-testid="add-cloze-btn"
                  onClick={() => setClozePickerOpen(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  Add to Anki as Cloze
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Pick a word to blank:</p>
                  <div className="flex flex-wrap gap-1" data-testid="cloze-word-chips">
                    {word
                      .split(/\s+/)
                      .filter(Boolean)
                      .map((w, i) => (
                        <button
                          key={i}
                          data-testid={`cloze-chip-${i}`}
                          onClick={() => setClozeBlankWord(clozeBlankWord === w ? null : w)}
                          className={`rounded px-2 py-0.5 text-sm font-medium transition-colors ${
                            clozeBlankWord === w
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-foreground hover:bg-accent'
                          }`}
                        >
                          {w}
                        </button>
                      ))}
                  </div>
                  {clozeBlankWord && (
                    <p
                      className="font-mono text-xs text-muted-foreground"
                      data-testid="cloze-preview"
                    >
                      {word
                        .split(/\s+/)
                        .filter(Boolean)
                        .map((w, i) => (
                          <span key={i}>
                            {i > 0 && ' '}
                            {w === clozeBlankWord ? (
                              <span className="font-semibold text-primary">[{w}]</span>
                            ) : (
                              w
                            )}
                          </span>
                        ))}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      data-testid="cloze-send-btn"
                      onClick={async () => {
                        if (!clozeBlankWord || clozeStatus === 'loading' || clozeStatus === 'done')
                          return;
                        setClozeStatus('loading');
                        try {
                          await onAddCloze(clozeBlankWord);
                          setClozeStatus('done');
                        } catch {
                          setClozeStatus('error');
                        }
                      }}
                      disabled={
                        !clozeBlankWord || clozeStatus === 'loading' || clozeStatus === 'done'
                      }
                      className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                        !clozeBlankWord || clozeStatus === 'loading'
                          ? 'cursor-not-allowed border-border text-muted-foreground opacity-50'
                          : clozeStatus === 'done'
                            ? 'cursor-default border-primary/40 bg-primary/10 text-[var(--primary-text)]'
                            : clozeStatus === 'error'
                              ? 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20'
                              : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      {clozeStatus === 'done'
                        ? '✓ Sent to Anki'
                        : clozeStatus === 'loading'
                          ? 'Sending…'
                          : clozeStatus === 'error'
                            ? 'Error — retry'
                            : 'Send to Anki'}
                    </button>
                    {clozeStatus !== 'done' && (
                      <button
                        data-testid="cloze-cancel-btn"
                        onClick={() => {
                          setClozePickerOpen(false);
                          setClozeBlankWord(null);
                          setClozeStatus('idle');
                        }}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(content, document.body);
}
