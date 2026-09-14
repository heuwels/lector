import type { LanguageConfig } from '@/lib/languages';

/**
 * The line-breaking rule the reader applies to a lesson, by script class.
 *
 * A browser breaks a Korean line anywhere, because Hangul syllables carry no
 * break opportunity of their own. Korean writes spaces, so it has real break
 * points, and breaking between them splits a word: 도서관에서 lands as 도서관에
 * and 서 on the next line. `keep-all` holds each eojeol together and breaks at
 * the spaces instead.
 *
 * This is the reason `script.kind` separates 'hangul' from 'alpha-spaced'. The
 * tokenizer treats the two the same.
 *
 * Chinese and Japanese write no spaces, so they need the browser's default and
 * `keep-all` would give them one unbreakable line.
 */
export function readerWrapClass(pack: LanguageConfig): string {
  // Biblical Hebrew writes maqaf, a Unicode break opportunity. keep-all
  // holds גַם־שְׁנֵיהֶם on one line and still wraps at the real spaces.
  if (pack.script.kind === 'hangul' || pack.code === 'hbo') return 'break-keep';
  return '';
}
