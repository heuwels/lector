'use client';

import {
  Fragment,
  cloneElement,
  isValidElement,
  memo,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import type { LanguageConfig, WordSegmentation } from '@/lib/languages';
import { foldWord, splitSentences } from '@/lib/languages';
import type { WordState } from '@/types';
import { collectWords, computePhraseHighlightSet, readableText, splitWords } from './utils';
import { wordReading, type AnnotationMode } from './annotation';
import WordCell from '@/components/WordCell';

export interface ActiveReaderWord {
  blockId: number;
  wordIndex: number;
}

export interface ReaderBlockProps {
  as: 'p' | 'li';
  children: ReactNode;
  blockId: number;
  contentVersion: string;
  pack: LanguageConfig;
  /** The lesson's stored segmentation (#289 4.2); null falls back to ICU. */
  segmentation: WordSegmentation | null;
  knownWordsMap: Map<string, WordState>;
  /**
   * Folded word -> pronunciation, for the ruby layer (#289 4.4). Null when the
   * pack declares no annotation source or the fetch is still in flight.
   *
   * Fetched once per lesson and never patched, so the comparator below can
   * treat it as immutable and compare it by identity.
   */
  readings: Map<string, string> | null;
  annotationMode: AnnotationMode;
  highlightedPhrase: string[];
  activeWord: ActiveReaderWord | null;
  onWordClick: (word: string, sentence: string) => void;
  onActivateWord: (word: ActiveReaderWord) => void;
  onClearPhrase: () => void;
}

function findSentence(element: HTMLElement, pack: LanguageConfig): string {
  const block = element.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6');
  // readableText, not textContent: a ruby annotation would otherwise interleave
  // into both strings (#289 4.4), the includes() test below would fail, and the
  // whole polluted block would be returned and then saved to vocab.sentence.
  const text = block ? readableText(block) : '';
  const wordText = readableText(element);

  for (const sentence of splitSentences(text, pack)) {
    if (sentence.includes(wordText)) return sentence.trim();
  }
  return text.trim();
}

/** Only re-render a body block when its own words or interaction state changed. */
export function readerBlockPropsEqual(previous: ReaderBlockProps, next: ReaderBlockProps): boolean {
  if (
    previous.as !== next.as ||
    previous.blockId !== next.blockId ||
    previous.contentVersion !== next.contentVersion ||
    previous.pack.code !== next.pack.code ||
    // Identity is enough: MarkdownReader memoizes it on lesson.segmentWords, so
    // a new object means a different segmentation and every span must re-split.
    previous.segmentation !== next.segmentation ||
    // Both must be here. `annotationMode` is what the toggle changes, and
    // nothing else about a block changes with it, so a block left out of this
    // list keeps its old ruby until some unrelated prop moves. `readings` is
    // immutable per lesson, so identity is enough.
    previous.annotationMode !== next.annotationMode ||
    previous.readings !== next.readings ||
    previous.onWordClick !== next.onWordClick ||
    previous.onActivateWord !== next.onActivateWord ||
    previous.onClearPhrase !== next.onClearPhrase
  ) {
    return false;
  }

  if (previous.highlightedPhrase.join('\u0000') !== next.highlightedPhrase.join('\u0000')) {
    return false;
  }

  const previousActiveIndex =
    previous.activeWord?.blockId === previous.blockId ? previous.activeWord.wordIndex : null;
  const nextActiveIndex =
    next.activeWord?.blockId === next.blockId ? next.activeWord.wordIndex : null;
  if (previousActiveIndex !== nextActiveIndex) return false;

  if (previous.knownWordsMap === next.knownWordsMap) return true;
  const words = new Set(
    collectWords(previous.children, previous.pack, previous.segmentation).map((word) =>
      foldWord(word, previous.pack),
    ),
  );
  for (const word of words) {
    if (previous.knownWordsMap.get(word) !== next.knownWordsMap.get(word)) return false;
  }
  return true;
}

const ReaderBlock = memo(function ReaderBlock({
  as: Tag,
  children,
  blockId,
  pack,
  segmentation,
  knownWordsMap,
  readings,
  annotationMode,
  highlightedPhrase,
  activeWord,
  onWordClick,
  onActivateWord,
  onClearPhrase,
}: ReaderBlockProps) {
  const phraseSet = computePhraseHighlightSet(
    collectWords(children, pack, segmentation),
    highlightedPhrase,
    pack,
  );

  const renderChildren = (value: ReactNode, context: { i: number }, keyPrefix = 'r'): ReactNode => {
    if (typeof value === 'string') {
      return splitWords(value, pack, segmentation).map((part, index) => {
        if (!part.isWord) {
          return (
            <span key={`${keyPrefix}-${index}`} data-leaf="">
              {part.text}
            </span>
          );
        }

        const wordIndex = context.i++;
        const key = foldWord(part.text, pack);
        const state = knownWordsMap.get(key);
        const isPhraseHighlighted = phraseSet.has(wordIndex);
        const isActiveWord = activeWord?.blockId === blockId && activeWord.wordIndex === wordIndex;

        return (
          <WordCell
            key={`${keyPrefix}-${index}`}
            text={part.text}
            state={state}
            isActive={isActiveWord}
            isPhraseHighlighted={isPhraseHighlighted}
            reading={wordReading(annotationMode, readings, key, state)}
            readingOverhangs={pack.pronunciation.annotationOverhang === true}
            onActivate={(text, element) => {
              onClearPhrase();
              onActivateWord({ blockId, wordIndex });
              onWordClick(text, findSentence(element, pack));
            }}
          />
        );
      });
    }

    if (Array.isArray(value)) {
      return value.map((child, index) => (
        <Fragment key={`${keyPrefix}-${index}`}>
          {renderChildren(child, context, `${keyPrefix}-${index}`)}
        </Fragment>
      ));
    }

    if (isValidElement(value)) {
      const element = value as ReactElement<{ children?: ReactNode }>;
      if ((element.props as Record<string, unknown>)['data-leaf'] !== undefined) return element;
      return cloneElement(element, {}, renderChildren(element.props.children, context, keyPrefix));
    }

    return value;
  };

  const content = renderChildren(children, { i: 0 });
  // An annotated paragraph needs headroom for the reading above the word, and
  // how much depends on the layout.
  //
  // An OVERHANGING annotation is out of flow, so it adds nothing to the line box
  // and the leading reserves the room itself. 2.15 fits a 0.58em reading.
  //
  // An IN-FLOW annotation is part of the line box already, so the browser has
  // added its height. The leading only has to keep the lines from crowding, and
  // 2.7 is what Chinese needs to stay legible with pinyin on every word.
  const annotated = annotationMode !== 'off' && readings !== null;
  const overhangs = pack.pronunciation.annotationOverhang === true;
  const annotatedLeading = overhangs ? 'leading-[2.15]' : 'leading-[2.7]';
  return Tag === 'p' ? (
    <p className={`my-5 text-lg sm:text-xl ${annotated ? annotatedLeading : 'leading-[1.9]'}`}>
      {content}
    </p>
  ) : (
    <li className={annotated ? annotatedLeading : 'leading-relaxed'}>{content}</li>
  );
}, readerBlockPropsEqual);

interface ReaderArticleProps {
  content: string;
  pack: LanguageConfig;
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

function ReaderArticle({
  content,
  pack,
  segmentation,
  knownWordsMap,
  readings,
  annotationMode,
  highlightedPhrase,
  activeWord,
  onWordClick,
  onActivateWord,
  onClearPhrase,
}: ReaderArticleProps) {
  const blockProps = {
    contentVersion: content,
    pack,
    segmentation,
    knownWordsMap,
    readings,
    annotationMode,
    highlightedPhrase,
    activeWord,
    onWordClick,
    onActivateWord,
    onClearPhrase,
  };

  return (
    <article
      // The lesson's language, not the interface language. Han unification gives
      // one codepoint different glyph shapes per language: 直, 令, 骨 and 花 draw
      // differently under ja and zh-Hans. The document is lang="en", so a
      // browser picked the shapes by its own font order and could draw Japanese
      // text with Chinese forms.
      lang={pack.script.bcp47}
      dir={pack.script.direction}
      className="mx-auto max-w-[38em] px-4 py-8 text-foreground sm:px-8 sm:py-16 print:px-0 print:py-0"
      style={{ fontFamily: 'var(--font-literata), Georgia, serif' }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkBreaks]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-8 mb-4 font-sans text-3xl font-extrabold first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-8 mb-3 font-sans text-2xl font-bold first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-6 mb-2 font-sans text-xl font-bold first:mt-0">{children}</h3>
          ),
          p: ({ node, children }) => (
            <ReaderBlock as="p" blockId={node?.position?.start?.offset ?? 0} {...blockProps}>
              {children}
            </ReaderBlock>
          ),
          ul: ({ children }) => (
            <ul className="my-5 list-disc space-y-2 pl-6 text-lg sm:text-xl">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-5 list-decimal space-y-2 pl-6 text-lg sm:text-xl">{children}</ol>
          ),
          li: ({ node, children }) => (
            <ReaderBlock as="li" blockId={node?.position?.start?.offset ?? 0} {...blockProps}>
              {children}
            </ReaderBlock>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-6 border-l-4 border-border pl-4 text-foreground/75 italic">
              {children}
            </blockquote>
          ),
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-8 border-border" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}

export default memo(ReaderArticle);
