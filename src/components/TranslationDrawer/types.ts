import { VocabEntry, WordState } from '@/types';

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
  /** `dict` = built-in kaikki dict, `cache` = user-learned AI translation. */
  source?: 'dict' | 'cache';
}

export interface TranslationDrawerProps {
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
  /** True while the fast gloss is still streaming — renders a live caret. */
  isStreaming?: boolean;
  /** True while the rich "enrich" lookup is in flight. */
  isEnriching?: boolean;
  error?: string | null;

  /** Existing vocab record (if word was previously saved). */
  existingEntry?: VocabEntry | null;
  /** Reader-local state, including an optimistic state awaiting persistence. */
  wordState?: WordState;

  /** Guided-onboarding progress, shown beside the level buttons so the action
      and its effect on the first review stay visually connected. */
  onboardingSaveProgress?: {
    savedCount: number;
    target: number;
    currentWordSaved: boolean;
  };

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
  /** Upgrade a fast streamed gloss to the full dictionary entry (senses, IPA,
      etymology, related forms). When absent the Enrich button is hidden. */
  onEnrich?: () => void;
  /** Force a fresh LLM lookup, ignoring cache + local dict. */
  onRetranslate?: () => void;
  /** Look up a word referenced inside the entry (form-of glosses, lemma stem,
      related forms — issue #106). When absent, references render as plain text. */
  onLookupWord?: (word: string) => void;
  /** Push a pure word card to the default Anki deck (single-word selections only). */
  onAddToAnki?: () => Promise<void>;
  /** Push a cloze card — called with the word the user chose to blank (phrase selections only). */
  onAddCloze?: (blankWord: string) => Promise<void>;
}
