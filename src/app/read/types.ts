import { ExpandedDictionaryEntry } from "@/lib/dictionary-client";
import { VocabEntry } from "@/types";

export interface WordPanelState {
  isOpen: boolean;
  word: string;
  sentence: string;
  translation: string | null;
  partOfSpeech: string | null;
  dictEntry: ExpandedDictionaryEntry | null;
  /** Active AI-in-context override translation. When set, the drawer renders this
      instead of the dictionary senses, but vocab saves still prefer the dict's
      broader glosses (so a narrow contextual gloss like "pull" doesn't replace
      the canonical "pull/move/draw/journey/draught" entry). */
  aiContextTranslation: string | null;
  aiContextPartOfSpeech: string | null;
  /** Structured AI translation (from /api/translate). Populated whenever the AI
      returns multi-sense output, regardless of which translation is shown. Used
      to persist the entry into the on-device cache when the user accepts
      (Save / Known / level). Distinct from `dictEntry` so we can tell a kaikki
      dict hit from an AI cacheable result. */
  aiStructured: {
    senses: Array<{ partOfSpeech: string; gloss: string }>;
    ipa?: string;
    etymology?: string;
    relatedForms?: Array<{ form: string; relation: string }>;
  } | null;
  phraseDetails: {
    literalBreakdown?: string;
    idiomaticMeaning?: string;
    usageNotes?: string;
    register?: string;
  } | null;
  isLoading: boolean;
  isContextLoading: boolean;
  /** True while the fast-path gloss is still streaming in token-by-token. */
  isStreamingGloss: boolean;
  /** True while the opt-in rich "enrich" lookup is in flight. */
  isEnriching: boolean;
  isDictionaryResult: boolean;
  error: string | null;
  existingEntry: VocabEntry | null;
}