import type { LanguageConfig, WordSegmentation } from '@/lib/languages';
import type { WordState } from '@/types';
import type { AnnotationMode } from '../annotation';
import type { ProseStyle } from '@/lib/prose-style';

export interface ReaderArticleProps {
  content: string;
  pack: LanguageConfig;
  /** Resolved reader typography (#570). */
  prose: ProseStyle;
  segmentation: WordSegmentation | null;
  knownWordsMap: Map<string, WordState>;
  readings: Map<string, string> | null;
  annotationMode: AnnotationMode;
  highlightedPhrase: string[];
  activeWord: ActiveReaderWord | null;
  onWordClick: (word: string, sentence: string) => void;
  onActivateWord: (word: ActiveReaderWord) => void;
  onClearPhrase: () => void;
}
