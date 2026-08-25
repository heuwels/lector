'use client';

import type { ReactNode } from 'react';

import { useActiveLanguage } from '@/utils/hooks';

/**
 * Target-language text rendered inside the English UI (#253).
 *
 * The reader sets `dir` on the article and everything inside inherits it
 * (ReaderArticle, TranscriptReader). Every other surface is the opposite case:
 * an English page with one Arabic word, sentence or headword dropped into it,
 * and there the base direction is wrong for that run.
 *
 * Two things go wrong without this, and neither is subtle:
 *
 *  - Punctuation MOVES. The Unicode bidi algorithm resolves a neutral character
 *    against the surrounding paragraph, so a full stop after an Arabic sentence
 *    inside an ltr block renders on the LEFT of the sentence, which is the
 *    wrong end. A quoted "مدرسة" loses its quotes to the far side, and a
 *    parenthesis flips into the mirror bracket at the wrong end of the run.
 *  - Mixed runs REORDER. An English gloss beside an Arabic headword, or a Latin
 *    loanword inside an Arabic sentence, gets pulled to whichever end the
 *    paragraph direction dictates rather than staying where it was written.
 *
 * `<bdi>` is the element for exactly this: it isolates the run so its direction
 * cannot leak out and the paragraph's cannot leak in. `dir` gives the run its
 * own base direction, and `lang` lets the browser pick Arabic shaping and font
 * fallback rather than guessing from the code points.
 *
 * A no-op for every ltr pack beyond an extra inline element, so call sites do
 * not branch on the language.
 */
export default function TargetText({
  children,
  className,
  as = 'bdi',
  title,
  testId,
}: {
  children: ReactNode;
  className?: string;
  /** 'bdi' for a run inside a sentence; 'div' where the text is the block. */
  as?: 'bdi' | 'div' | 'p' | 'span';
  title?: string;
  testId?: string;
}) {
  const pack = useActiveLanguage();
  // A block-level element cannot be a <bdi>, so isolation comes from the CSS
  // property instead. `dir` alone would not isolate — it sets the base
  // direction and still lets a neighbouring run reorder against it.
  const Tag = as;
  const isolate = as === 'bdi' ? undefined : ('isolate' as const);
  return (
    <Tag
      dir={pack.script.direction}
      lang={pack.script.bcp47}
      className={className}
      title={title}
      data-testid={testId}
      style={isolate ? { unicodeBidi: isolate } : undefined}
    >
      {children}
    </Tag>
  );
}
