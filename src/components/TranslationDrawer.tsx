'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { WordState, VocabEntry } from '@/lib/db';

/**
 * Shape returned by /api/dictionary/lookup. Mirror of the server-side type — kept in
 * sync with src/lib/server/dictionary-db.ts. Optional fields may be absent for sparse
 * Wiktionary entries.
 */
export interface ExpandedDictionaryEntry {
  word: string;
  rank?: number;
  ipa?: string;
  etymology?: string;
  senses: Array<{ partOfSpeech: string; gloss: string }>;
  relatedForms?: Array<{ form: string; relation: string }>;
  lemmaInfo?: { stem: string; label: string };
}

const wordStateColors: Record<WordState, { bg: string; text: string; dot: string; ring: string }> = {
  'new':     { bg: 'bg-blue-100 dark:bg-blue-900/40',     text: 'text-blue-700 dark:text-blue-300',     dot: 'bg-blue-500',   ring: 'ring-blue-500' },
  'level1':  { bg: 'bg-red-100 dark:bg-red-900/40',       text: 'text-red-700 dark:text-red-300',       dot: 'bg-red-500',    ring: 'ring-red-500' },
  'level2':  { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500', ring: 'ring-orange-500' },
  'level3':  { bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-500', ring: 'ring-yellow-500' },
  'level4':  { bg: 'bg-lime-100 dark:bg-lime-900/40',     text: 'text-lime-700 dark:text-lime-300',     dot: 'bg-lime-500',   ring: 'ring-lime-500' },
  'known':   { bg: 'bg-green-100 dark:bg-green-900/40',   text: 'text-green-700 dark:text-green-300',   dot: 'bg-green-500',  ring: 'ring-green-500' },
  'ignored': { bg: 'bg-gray-100 dark:bg-gray-800',        text: 'text-gray-500 dark:text-gray-400',     dot: 'bg-gray-400',   ring: 'ring-gray-400' },
};

const wordStateLabels: Record<WordState, string> = {
  'new': 'New', 'level1': 'Level 1', 'level2': 'Level 2', 'level3': 'Level 3',
  'level4': 'Level 4', 'known': 'Known', 'ignored': 'Ignored',
};

const SpeakerIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
  </svg>
);

interface TranslationDrawerProps {
  isOpen: boolean;
  word: string;
  sentence: string;

  /** Rich definition from local dictionary. Null while loading or when not found. */
  entry?: ExpandedDictionaryEntry | null;

  /** AI fallback translation (used when entry is null/absent). */
  aiTranslation?: string | null;
  aiPartOfSpeech?: string | null;
  /** Active AI in-context override. When set, the drawer shows this in place
      of the dictionary senses (but `entry` stays in state so the page's save
      handlers can keep the dictionary translation as canonical). */
  aiContextTranslation?: string | null;
  aiContextPartOfSpeech?: string | null;
  /** Rich AI phrase details — populated when the word is a multi-word phrase. */
  aiPhraseDetails?: {
    literalBreakdown?: string;
    idiomaticMeaning?: string;
    usageNotes?: string;
    register?: string;
  } | null;

  /** Whether the displayed result came from the on-device dictionary. */
  isDictionaryResult?: boolean;

  isLoading?: boolean;
  isContextLoading?: boolean;
  error?: string | null;

  /** Existing vocab record (if word was previously saved). */
  existingEntry?: VocabEntry | null;

  onClose: () => void;
  onSpeak: (text: string) => void;
  /** Optional — provide to enable level 1-4 buttons in the footer. */
  onSetLevel?: (level: 1 | 2 | 3 | 4) => void;
  /** Optional — provide to enable the Known action. */
  onMarkKnown?: () => void;
  /** Optional — provide to enable the Ignore action. */
  onIgnore?: () => void;
  /** Request a fresh contextual translation from the AI (uses surrounding sentence). */
  onRequestContextTranslation?: () => void;
  /** Force a fresh LLM lookup, ignoring cache + local dict. */
  onRetranslate?: () => void;
}

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
  error,
  existingEntry,
  onClose,
  onSpeak,
  onSetLevel,
  onMarkKnown,
  onIgnore,
  onRequestContextTranslation,
  onRetranslate,
}: TranslationDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [relatedExpanded, setRelatedExpanded] = useState(false);

  // Reset the "show all related forms" toggle whenever the looked-up word changes,
  // so each new entry starts collapsed.
  useEffect(() => {
    setRelatedExpanded(false);
  }, [word]);

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

  const currentState = existingEntry?.state ?? 'new';
  const stateColors = wordStateColors[currentState];
  const isPhrase = word.includes(' ');

  const senses = entry?.senses ?? [];
  const hasRichEntry = senses.length > 0;
  const fallbackTranslation = aiTranslation ?? null;

  const content = (
    <div
      data-testid="translation-drawer"
      aria-hidden={!isOpen}
      className={`
        fixed inset-y-0 right-0 z-50
        w-full sm:w-96 max-w-full
        bg-white dark:bg-zinc-900
        border-l border-zinc-200 dark:border-zinc-700
        shadow-2xl
        flex flex-col
        transition-transform duration-300 ease-out
        ${isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'}
      `}
      ref={drawerRef}
      role="dialog"
      aria-label={`Definition of ${word}`}
    >
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${stateColors.dot}`} title={wordStateLabels[currentState]} />
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 break-words">
                {word}
              </h2>
              <button
                onClick={handleSpeakWord}
                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
                title="Hear pronunciation"
                aria-label="Hear pronunciation"
              >
                <SpeakerIcon className="w-5 h-5" />
              </button>
              {entry?.ipa && (
                <span className="text-sm font-mono text-zinc-500 dark:text-zinc-400">
                  {entry.ipa}
                </span>
              )}
            </div>
            {entry?.lemmaInfo && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {entry.lemmaInfo.label}{' '}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{entry.lemmaInfo.stem}</span>
              </p>
            )}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md ${stateColors.bg} ${stateColors.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${stateColors.dot}`} />
                {wordStateLabels[currentState]}
              </span>
              {/* Source attribution — always tells the user where the
                  currently-displayed translation came from. */}
              {aiContextTranslation ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  AI · in context
                </span>
              ) : isDictionaryResult ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  on-device
                </span>
              ) : (fallbackTranslation || aiPhraseDetails) && !isLoading ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  AI
                </span>
              ) : null}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors flex-shrink-0"
            aria-label="Close"
            title="Close (Esc)"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {/* Definition section */}
        <section className="px-4 py-4 border-b border-zinc-200 dark:border-zinc-700">
          {isLoading ? (
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 text-sm">
              <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Looking up…
            </div>
          ) : error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : aiContextTranslation ? (
            <div>
              <div>
                {aiContextPartOfSpeech && (
                  <span className="inline-block text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 mr-2 align-middle">
                    {aiContextPartOfSpeech}
                  </span>
                )}
                <span className="text-zinc-800 dark:text-zinc-200 leading-relaxed">
                  {aiContextTranslation}
                </span>
              </div>
              {hasRichEntry && (
                <details className="mt-3 group">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 list-none flex items-center gap-1">
                    <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    Show dictionary ({senses.length})
                  </summary>
                  <ol className="mt-2 space-y-2">
                    {senses.map((sense, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="flex-shrink-0 text-xs font-medium text-zinc-400 dark:text-zinc-500 mt-0.5 tabular-nums">
                          {i + 1}.
                        </span>
                        <div className="min-w-0 flex-1">
                          {sense.partOfSpeech && (
                            <span className="inline-block text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 mr-2 align-middle">
                              {sense.partOfSpeech}
                            </span>
                          )}
                          <span className="text-zinc-700 dark:text-zinc-300">{sense.gloss}</span>
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
                  <span className="flex-shrink-0 text-xs font-medium text-zinc-400 dark:text-zinc-500 mt-0.5 tabular-nums">
                    {i + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    {sense.partOfSpeech && (
                      <span className="inline-block text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 mr-2 align-middle">
                        {sense.partOfSpeech}
                      </span>
                    )}
                    <span className="text-zinc-800 dark:text-zinc-200 leading-relaxed">
                      {sense.gloss}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : fallbackTranslation ? (
            <div>
              {aiPartOfSpeech && (
                <span className="inline-block text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 mr-2 align-middle">
                  {aiPartOfSpeech}
                </span>
              )}
              <span className="text-zinc-800 dark:text-zinc-200 leading-relaxed">
                {fallbackTranslation}
              </span>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">No definition found.</p>
          )}

          {/* In-context AI button — always offered for single-word lookups so the
              user can ask the LLM to re-read the sentence and give a more nuanced
              translation than the bare dictionary gloss. */}
          {!isPhrase && !isLoading && !isContextLoading && onRequestContextTranslation && (
            <button
              onClick={onRequestContextTranslation}
              className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md
                bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400
                hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
              title="Translate using AI with sentence context"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              In context
            </button>
          )}
          {isContextLoading && (
            <span className="mt-3 inline-flex items-center gap-1.5 text-xs text-indigo-500">
              <span className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              Asking AI…
            </span>
          )}
        </section>

        {/* Rich phrase details (idiom, literal breakdown, usage notes, register) */}
        {aiPhraseDetails && (aiPhraseDetails.literalBreakdown || aiPhraseDetails.idiomaticMeaning || aiPhraseDetails.usageNotes || aiPhraseDetails.register) && (
          <section className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 space-y-3">
            {aiPhraseDetails.idiomaticMeaning && (
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">
                  Idiomatic meaning
                </h3>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                  {aiPhraseDetails.idiomaticMeaning}
                </p>
              </div>
            )}
            {aiPhraseDetails.literalBreakdown && (
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">
                  Literally
                </h3>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed italic">
                  {aiPhraseDetails.literalBreakdown}
                </p>
              </div>
            )}
            {aiPhraseDetails.usageNotes && (
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">
                  Usage
                </h3>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                  {aiPhraseDetails.usageNotes}
                </p>
              </div>
            )}
            {aiPhraseDetails.register && aiPhraseDetails.register !== 'neutral' && (
              <div className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                {aiPhraseDetails.register}
              </div>
            )}
          </section>
        )}

        {/* Etymology */}
        {entry?.etymology && (
          <section className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">
              Etymology
            </h3>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
              {entry.etymology}
            </p>
          </section>
        )}

        {/* Related forms — capped at 3 with expand toggle to keep the drawer
            from being flooded by polysemous words (e.g. "Dit" has ~20 forms). */}
        {entry?.relatedForms && entry.relatedForms.length > 0 && (() => {
          const total = entry.relatedForms.length;
          const COLLAPSED_COUNT = 3;
          const shown = relatedExpanded ? entry.relatedForms : entry.relatedForms.slice(0, COLLAPSED_COUNT);
          const hiddenCount = total - shown.length;
          return (
            <section className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
                Related forms
              </h3>
              <ul className="space-y-1">
                {shown.map((r, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">{r.form}</span>
                    <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{r.relation}</span>
                  </li>
                ))}
              </ul>
              {total > COLLAPSED_COUNT && (
                <button
                  onClick={() => setRelatedExpanded((v) => !v)}
                  className="mt-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                >
                  {relatedExpanded ? 'Show fewer' : `Show all (${total})`}
                  {!relatedExpanded && hiddenCount > 0 && (
                    <span className="ml-1 text-zinc-400 dark:text-zinc-500">+{hiddenCount}</span>
                  )}
                </button>
              )}
            </section>
          );
        })()}

        {/* Sentence — only render if a sentence was provided */}
        {sentence && (
          <section className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
            <div className="flex items-start gap-2">
              <p className="flex-1 text-sm text-zinc-600 dark:text-zinc-400 italic leading-relaxed">
                {sentence}
              </p>
              <button
                onClick={handleSpeakSentence}
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors flex-shrink-0"
                title="Hear sentence"
                aria-label="Hear sentence"
              >
                <SpeakerIcon className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Footer — action buttons. Hidden if no level/known/ignore/retranslate callbacks are provided. */}
      {(onSetLevel || onMarkKnown || onIgnore || onRetranslate) && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 space-y-2">
          {(onSetLevel || onMarkKnown || onIgnore) && (
            <div className="flex items-center gap-2 flex-wrap">
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
                        className={`w-9 h-9 rounded-lg text-sm font-semibold transition-all
                          ${isActive
                            ? `${colors.bg} ${colors.text} ring-2 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900 ${colors.ring}`
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
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
                  className={`px-3 h-9 rounded-lg text-sm font-medium transition-colors
                    ${currentState === 'known'
                      ? 'bg-green-500 text-white ring-2 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900 ring-green-500'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-green-50 dark:hover:bg-green-900/20 hover:text-green-700 dark:hover:text-green-300'
                    }`}
                  title="Mark as known (K)"
                >
                  ✓ Known
                </button>
              )}
              {onIgnore && (
                <button
                  onClick={onIgnore}
                  className={`px-3 h-9 rounded-lg text-sm font-medium transition-colors
                    ${currentState === 'ignored'
                      ? 'bg-zinc-500 text-white ring-2 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900 ring-zinc-500'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
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
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              title="Force fresh AI lookup (ignores dictionary)"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Re-translate with AI
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(content, document.body);
}
