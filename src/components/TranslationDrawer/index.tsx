'use client';

import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { WordState } from '@/types';
import { sentenceContainsWord } from '@/lib/words';
import { useActiveLanguage, useScreenSize } from '@/utils/hooks';
import { TranslationDrawerProps } from './types';
import { wordStateColors, wordStateLabels } from './constants';
import { ChevronRight, RefreshCw, Sparkles, Volume2, X, Zap } from 'lucide-react';
import TargetText from '@/components/TargetText';
import NestedWordButton from './components/NestedWordButton';
import Gloss from './components/Gloss';
import { lookupAnnouncement } from './lookup-announcement';

export { type ExpandedDictionaryEntry } from './types';
export { TranslationDrawerSlot } from './slot';

export default function TranslationDrawer({
  isOpen: rawIsOpen,
  word,
  sentence,
  anchor,
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
  const screenSize = useScreenSize();
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

  const docked = screenSize === '2xl';
  const isOpen = useMemo(() => docked || rawIsOpen, [docked, rawIsOpen]);
  const idle = docked && !word.trim();

  // Popup mode keeps rendering for one short transition after rawIsOpen goes
  // false, so the close reads as a fade-out instead of a hard unmount.
  // Adjusted during render (like prevWord above), not an effect: re-targeting
  // the popup to a new word while open must not trigger this.
  const [shouldRenderPopup, setShouldRenderPopup] = useState(rawIsOpen);
  const [popupClosing, setPopupClosing] = useState(false);
  const [popupEntering, setPopupEntering] = useState(rawIsOpen);
  if (rawIsOpen && !shouldRenderPopup) {
    setShouldRenderPopup(true);
    setPopupClosing(false);
    setPopupEntering(true);
  } else if (!rawIsOpen && shouldRenderPopup && !popupClosing) {
    setPopupClosing(true);
  }
  // One frame at the closed-looking classes, then release to the open ones,
  // so the transition actually has a "from" state to animate out of instead
  // of mounting already fully open.
  useEffect(() => {
    if (!popupEntering) return;
    const raf = requestAnimationFrame(() => setPopupEntering(false));
    return () => cancelAnimationFrame(raf);
  }, [popupEntering]);
  useEffect(() => {
    if (!popupClosing) return;
    const timer = setTimeout(() => {
      setShouldRenderPopup(false);
      setPopupClosing(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [popupClosing]);

  useEffect(() => {
    if (!isOpen || docked) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, docked]);

  // Popup mode (non-docked): positioned next to the clicked word instead of
  // sliding in from the side. Recomputed on every content resize (e.g. the
  // "More details" disclosure opening) via ResizeObserver, not just on open.
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (docked || !rawIsOpen || !anchor) return;
    const el = popupRef.current;
    if (!el) return;
    const margin = 8;
    const compute = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const left = Math.min(Math.max(anchor.left, margin), Math.max(margin, vw - width - margin));
      let top = anchor.bottom + margin;
      if (top + height > vh - margin) {
        const above = anchor.top - margin - height;
        top = above >= margin ? above : Math.max(margin, vh - height - margin);
      }
      setPopupPos({ top, left });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [docked, rawIsOpen, anchor, word]);

  // Dismiss the popup on an outside click or a reader scroll. A click on
  // another word is exempted — the reader's own click handler re-targets the
  // popup to it, this must not race that by closing first. Reader content
  // (word clicks, phrase drag-selection) is exempted the same way via
  // `data-reader-content` on the scroll container.
  useEffect(() => {
    if (docked || !rawIsOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (popupRef.current?.contains(target)) return;
      if (target.closest('[data-reader-content]')) return;
      onClose();
    };
    const handleScroll = (e: Event) => {
      const target = e.target as Node;
      if (popupRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [docked, rawIsOpen, onClose]);

  const handleSpeakWord = useCallback(() => onSpeak(word), [onSpeak, word]);
  const handleSpeakSentence = useCallback(() => onSpeak(sentence), [onSpeak, sentence]);

  // Popup actions (level/known/ignore): run the action immediately — its
  // optimistic color shows right away — then close on a short delay so that
  // color is actually visible for a beat before the popup fades, instead of
  // both state changes landing in the same paint.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  const actAndClose = useCallback(
    (action: () => void) => {
      action();
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(onClose, 180);
    },
    [onClose],
  );

  // Languages with `pronunciation.audio: 'none'` (#307 §3.2a) have no sensible
  // synthesized voice — the speaker buttons absent themselves entirely.
  const speakable = pack.pronunciation.audio !== 'none';

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
  const announcement = lookupAnnouncement({
    isOpen,
    word,
    isLoading: !!isLoading,
    error,
    hasResult: !!(hasRichEntry || fallbackTranslation || aiContextTranslation || aiPhraseDetails),
  });

  // Popup mode shows one gloss up front; everything else — the rest of the
  // senses, etymology, related forms, phrase details, sentence, Anki — sits
  // behind "More details" instead of a scrollable wall of sections.
  const primaryPartOfSpeech = aiContextTranslation
    ? aiContextPartOfSpeech
    : hasRichEntry
      ? senses[0]?.partOfSpeech
      : aiPartOfSpeech;
  const primaryGloss =
    aiContextTranslation ?? (hasRichEntry ? senses[0]?.gloss : fallbackTranslation);
  const hasMoreDetails =
    (hasRichEntry && senses.length > 1) ||
    !!entry?.etymology ||
    !!(entry?.relatedForms && entry.relatedForms.length > 0) ||
    !!aiPhraseDetails ||
    !!sentence ||
    !!onRequestContextTranslation ||
    !!onEnrich ||
    !!onRetranslate ||
    !!onAddToAnki ||
    !!onAddCloze;

  const content = (
    <div
      data-testid="translation-drawer"
      aria-hidden={docked ? false : !isOpen}
      className={clsx(
        'flex flex-col border-l border-border bg-popover print:hidden',
        docked
          ? 'relative h-full w-full translate-x-0 shadow-none'
          : [
              'fixed inset-y-0 right-0 z-50 max-h-screen w-full max-w-full shadow-2xl transition-transform duration-300 ease-out sm:max-w-96',
              isOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full',
            ],
      )}
      ref={drawerRef}
      role={docked ? 'complementary' : 'dialog'}
      aria-label={idle ? 'Word definition' : `Definition of ${word}`}
    >
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="lookup-announcement"
      >
        {announcement}
      </div>
      {idle ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p data-testid="translation-drawer-empty" className="text-sm text-muted-foreground">
            Click a word to look it up.
          </p>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex-shrink-0 border-b border-border bg-muted/50 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${stateColors.dot}`}
                    title={wordStateLabels[currentState]}
                  />
                  <h2 className="text-xl font-semibold break-words text-foreground">
                    <TargetText>{word}</TargetText>
                  </h2>
                  {speakable && (
                    <button
                      onClick={handleSpeakWord}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title="Hear pronunciation"
                      aria-label="Hear pronunciation"
                    >
                      <Volume2 className="h-5 w-5" />
                    </button>
                  )}
                  {entry?.ipa && (
                    <TargetText
                      className={`text-sm text-muted-foreground ${
                        pack.script.direction === 'rtl' ? '' : 'font-mono'
                      }`}
                      as="span"
                    >
                      {entry.ipa}
                    </TargetText>
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
                      <TargetText className="font-medium text-foreground" as="span">
                        {entry.lemmaInfo.stem}
                      </TargetText>
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
                className={clsx(
                  'flex-shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  docked && 'hidden',
                )}
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
                            <TargetText className="font-medium text-foreground" as="span">
                              {r.form}
                            </TargetText>
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
                  <TargetText
                    className="flex-1 text-sm leading-relaxed text-muted-foreground italic"
                    as="p"
                  >
                    {sentence}
                  </TargetText>
                  {speakable && (
                    <button
                      onClick={handleSpeakSentence}
                      className="flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title="Hear sentence"
                      aria-label="Hear sentence"
                    >
                      <Volume2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </section>
            )}
          </div>

          {/* Footer — action buttons. */}
          {(onSetLevel ||
            onMarkKnown ||
            onIgnore ||
            onRetranslate ||
            onAddToAnki ||
            onAddCloze) && (
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
                            if (
                              !clozeBlankWord ||
                              clozeStatus === 'loading' ||
                              clozeStatus === 'done'
                            )
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
        </>
      )}
    </div>
  );

  const popupContent = (
    <div
      ref={popupRef}
      data-testid="translation-drawer"
      aria-hidden={false}
      role="dialog"
      aria-label={`Definition of ${word}`}
      className={clsx(
        'fixed z-50 w-80 max-w-[calc(100vw-16px)] origin-top rounded-xl border border-border bg-popover shadow-2xl transition-[opacity,transform] duration-150 ease-in print:hidden',
        popupClosing || popupEntering
          ? 'pointer-events-none scale-95 opacity-0'
          : 'scale-100 opacity-100',
      )}
      style={{
        top: popupPos?.top ?? -9999,
        left: popupPos?.left ?? -9999,
        visibility: popupPos ? 'visible' : 'hidden',
      }}
    >
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="lookup-announcement"
      >
        {announcement}
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${stateColors.dot}`}
            title={wordStateLabels[currentState]}
          />
          <h2 className="truncate text-base font-semibold text-foreground">
            <TargetText>{word}</TargetText>
          </h2>
          {speakable && (
            <button
              onClick={handleSpeakWord}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Hear pronunciation"
              aria-label="Hear pronunciation"
            >
              <Volume2 className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Close"
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Translation — the one thing you came here for */}
      <div className="px-3 py-2.5">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Looking up…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : primaryGloss ? (
          <div className="text-sm leading-relaxed text-foreground">
            {primaryPartOfSpeech && (
              <span className="mr-1.5 inline-block rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                {primaryPartOfSpeech}
              </span>
            )}
            {primaryGloss}
            {isStreaming && (
              <span
                className="-mb-0.5 ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary"
                aria-hidden="true"
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No definition found.</p>
        )}
      </div>

      {/* Actions — the point of the popup: judge the word and move on. */}
      {(onSetLevel || onMarkKnown || onIgnore) && (
        <div className="space-y-2 border-t border-border bg-muted/50 px-3 py-2.5">
          {onboardingSaveProgress && (
            <div
              className="rounded-lg border border-[var(--gold-lip)] bg-[var(--gold-soft)] p-2"
              data-testid="onboarding-drawer-progress"
              role="status"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-foreground">
                  {onboardingSaveProgress.currentWordSaved
                    ? 'Added to your first review'
                    : 'Choose level 1–4 to add this word'}
                </span>
                <span className="shrink-0 font-bold text-[var(--gold-strong)]">
                  {Math.min(onboardingSaveProgress.savedCount, onboardingSaveProgress.target)}/
                  {onboardingSaveProgress.target}
                </span>
              </div>
            </div>
          )}
          {onSetLevel && (
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((level) => {
                const stateKey = `level${level}` as WordState;
                const isActive = currentState === stateKey;
                const colors = wordStateColors[stateKey];
                return (
                  <button
                    key={level}
                    onClick={() => actAndClose(() => onSetLevel(level as 1 | 2 | 3 | 4))}
                    data-testid={`word-level-${level}`}
                    aria-label={`Save at learning level ${level}`}
                    className={`h-8 flex-1 cursor-pointer rounded-lg text-sm font-semibold transition-all ${
                      isActive
                        ? `${colors.bg} ${colors.text} ring-2 ring-offset-1 ring-offset-popover ${colors.ring}`
                        : 'bg-muted text-muted-foreground hover:bg-accent'
                    }`}
                    title={`Level ${level} (${level})`}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
          )}
          {(onMarkKnown || onIgnore) && (
            <div className="flex gap-1.5">
              {onMarkKnown && (
                <button
                  onClick={() => actAndClose(onMarkKnown)}
                  data-testid="mark-word-known"
                  className={`h-8 flex-1 cursor-pointer rounded-lg px-2.5 text-sm font-medium transition-colors ${
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
                  onClick={() => actAndClose(onIgnore)}
                  data-testid="ignore-word"
                  className={`h-8 flex-1 cursor-pointer rounded-lg px-2.5 text-sm font-medium transition-colors ${
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
        </div>
      )}

      {/* Everything else, tucked away by default. */}
      {hasMoreDetails && (
        <details key={word} className="group border-t border-border">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground">
            <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
            More details
          </summary>
          <div className="max-h-72 space-y-3 overflow-y-auto px-3 pb-3">
            {hasRichEntry && senses.length > 1 && (
              <ol className="space-y-2">
                {senses.map((sense, i) => (
                  <li key={i} className="flex gap-2 text-sm">
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
            )}

            <div className="flex flex-wrap items-center gap-2">
              {!isPhrase &&
                !isLoading &&
                !isContextLoading &&
                onRequestContextTranslation &&
                wordOccursInSentence && (
                  <button
                    onClick={onRequestContextTranslation}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[var(--clay-soft)] px-2.5 py-1 text-xs font-medium text-[var(--clay)] transition-colors hover:bg-[color-mix(in_srgb,var(--clay)_18%,transparent)]"
                    title="Translate using AI with sentence context"
                  >
                    <Zap className="h-3 w-3" />
                    In context
                  </button>
                )}
              {isContextLoading && (
                <span className="inline-flex items-center gap-1.5 text-xs text-[var(--clay)]">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--clay)] border-t-transparent" />
                  Asking AI…
                </span>
              )}
              {onEnrich &&
                !isPhrase &&
                !isLoading &&
                !isStreaming &&
                !isContextLoading &&
                !isEnriching && (
                  <button
                    onClick={onEnrich}
                    className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Add IPA, etymology, full senses & related forms"
                  >
                    <Sparkles className="h-3 w-3" />
                    Enrich
                  </button>
                )}
              {isEnriching && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                  Enriching…
                </span>
              )}
            </div>

            {aiPhraseDetails &&
              (aiPhraseDetails.literalBreakdown ||
                aiPhraseDetails.idiomaticMeaning ||
                aiPhraseDetails.usageNotes ||
                aiPhraseDetails.register) && (
                <div className="space-y-2 border-t border-border pt-3">
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
                </div>
              )}

            {entry?.etymology && (
              <div className="border-t border-border pt-3">
                <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Etymology
                </h3>
                <p className="text-sm leading-relaxed text-foreground">{entry.etymology}</p>
              </div>
            )}

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
                  <div className="border-t border-border pt-3">
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
                            <TargetText className="font-medium text-foreground" as="span">
                              {r.form}
                            </TargetText>
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
                  </div>
                );
              })()}

            {sentence && (
              <div className="flex items-start gap-2 border-t border-border pt-3">
                <TargetText
                  className="flex-1 text-sm leading-relaxed text-muted-foreground italic"
                  as="p"
                >
                  {sentence}
                </TargetText>
                {speakable && (
                  <button
                    onClick={handleSpeakSentence}
                    className="flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Hear sentence"
                    aria-label="Hear sentence"
                  >
                    <Volume2 className="h-4 w-4" />
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
                          if (
                            !clozeBlankWord ||
                            clozeStatus === 'loading' ||
                            clozeStatus === 'done'
                          )
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
        </details>
      )}
    </div>
  );

  if (typeof document === 'undefined') return null;
  if (docked) return content;
  if (!shouldRenderPopup) return null;
  return createPortal(popupContent, document.body);
}
