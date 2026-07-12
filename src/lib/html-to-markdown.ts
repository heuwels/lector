import { countWords as countWordsForPack, normalizeText, type LanguageConfig } from './languages';

/**
 * Simple HTML to Markdown converter for Readability output.
 * Handles common HTML elements that Readability produces.
 */
export function htmlToMarkdown(html: string): string {
  let markdown = html;

  // Remove script and style tags
  markdown = markdown.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  markdown = markdown.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Handle headings
  markdown = markdown.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  markdown = markdown.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  markdown = markdown.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  markdown = markdown.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  markdown = markdown.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  markdown = markdown.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

  // Handle paragraphs
  markdown = markdown.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');

  // Handle line breaks
  markdown = markdown.replace(/<br\s*\/?>/gi, '\n');

  // Handle bold
  markdown = markdown.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');

  // Handle italic
  markdown = markdown.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // Handle links
  markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Handle blockquotes
  markdown = markdown.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const lines = content.trim().split('\n');
    return '\n' + lines.map((line: string) => `> ${line.trim()}`).join('\n') + '\n';
  });

  // Handle unordered lists
  markdown = markdown.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
    return '\n' + content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n') + '\n';
  });

  // Handle ordered lists
  markdown = markdown.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    let counter = 0;
    return (
      '\n' +
      content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => {
        counter++;
        return `${counter}. ` + '$1\n';
      }) +
      '\n'
    );
  });

  // Handle code blocks
  markdown = markdown.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
  markdown = markdown.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

  // Handle inline code
  markdown = markdown.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Handle horizontal rules
  markdown = markdown.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Handle figures and figcaptions (common in articles)
  markdown = markdown.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, '\n$1\n');
  markdown = markdown.replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, '*$1*\n');

  // Handle images - convert to markdown image syntax
  markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
  markdown = markdown.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
  markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  markdown = decodeHtmlEntities(markdown);

  // Clean up whitespace
  markdown = markdown.replace(/\n{3,}/g, '\n\n'); // Max 2 newlines
  markdown = markdown.replace(/^\s+|\s+$/g, ''); // Trim start/end
  markdown = markdown.replace(/[ \t]+/g, ' '); // Collapse spaces (but not newlines)
  markdown = markdown.replace(/ \n/g, '\n'); // Remove trailing spaces on lines

  // Text ingress (#289): NFC + invisible-char stripping so imported content
  // matches the dictionary and vocab keys byte-for-byte.
  return normalizeText(markdown);
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&ndash;': '\u2013',
    '&mdash;': '\u2014',
    '&lsquo;': '\u2018',
    '&rsquo;': '\u2019',
    '&ldquo;': '\u201C',
    '&rdquo;': '\u201D',
    '&hellip;': '\u2026',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&euro;': '€',
    '&pound;': '£',
    '&yen;': '¥',
    '&cent;': '¢',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, 'g'), char);
  }

  // Handle numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16))
  );

  return result;
}

/**
 * Count words in text. Delegates to the per-pack seam in languages/tokenizer
 * (#289): spaced scripts keep the historical whitespace count; unspaced CJK
 * swaps in a real token count in Phase 4 without touching callers.
 */
export function countWords(text: string, pack?: LanguageConfig): number {
  return countWordsForPack(text, pack);
}
