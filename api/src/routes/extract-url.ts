import { Hono } from 'hono';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { htmlToMarkdown, countWords } from '../lib/html-to-markdown';
import { safeFetch, readBodyCapped, SsrfError } from '../lib/safe-fetch';

const app = new Hono();

// Cap the fetched page so a hostile/huge response can't exhaust memory.
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB

// POST /api/extract-url — fetch a URL and extract its readable article as markdown.
app.post('/', async (c) => {
  try {
    const { url } = await c.req.json();

    if (!url || typeof url !== 'string') {
      return c.json({ error: 'URL is required', code: 'INVALID_URL' }, 400);
    }

    let html: string;
    try {
      // safeFetch enforces http(s) + blocks internal/metadata addresses (SSRF)
      // and re-validates every redirect hop. The 15s deadline bounds the whole
      // redirect chain.
      const response = await safeFetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5,af;q=0.3',
        },
        signal: AbortSignal.timeout(15000),
        maxRedirects: 5,
      });

      if (!response.ok) {
        return c.json(
          { error: `Could not fetch the page (HTTP ${response.status})`, code: 'FETCH_FAILED' },
          400,
        );
      }

      const bytes = await readBodyCapped(response, MAX_RESPONSE_BYTES);
      // Decode using the declared charset, falling back to UTF-8 for an absent
      // or unrecognised label (TextDecoder throws on an unknown encoding).
      const contentType = response.headers.get('content-type') || '';
      const charset = contentType.match(/charset=([^;]+)/i)?.[1].trim().toLowerCase() || 'utf-8';
      try {
        html = new TextDecoder(charset).decode(bytes);
      } catch {
        html = new TextDecoder('utf-8').decode(bytes);
      }
    } catch (error) {
      if (error instanceof SsrfError) {
        return c.json({ error: 'Please enter a valid, public URL.', code: 'INVALID_URL' }, 400);
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('too large')) {
        return c.json({ error: 'That page is too large to import.', code: 'FETCH_FAILED' }, 400);
      }
      if (message.includes('timeout') || message.includes('aborted')) {
        return c.json(
          { error: 'Request timed out. The page took too long to load.', code: 'FETCH_FAILED' },
          400,
        );
      }
      return c.json(
        { error: 'Could not fetch the page. Check the URL and try again.', code: 'FETCH_FAILED' },
        400,
      );
    }

    const hostname = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return '';
      }
    })();

    const { document } = parseHTML(html);
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (!article || !article.content) {
      return c.json({ error: 'No readable content found on this page.', code: 'NO_CONTENT' }, 400);
    }

    const markdownContent = htmlToMarkdown(article.content);
    if (!markdownContent.trim()) {
      return c.json({ error: 'No readable content found on this page.', code: 'NO_CONTENT' }, 400);
    }

    let author = article.byline || null;
    if (!author) {
      const authorMeta = document.querySelector('meta[name="author"]');
      if (authorMeta) {
        author = authorMeta.getAttribute('content');
      }
    }
    if (author) {
      author = author.replace(/^by\s+/i, '').trim();
    }

    return c.json({
      title: article.title || hostname,
      author,
      content: markdownContent,
      siteName: article.siteName || hostname,
      excerpt: article.excerpt || null,
      wordCount: countWords(markdownContent),
    });
  } catch (error) {
    console.error('Error extracting article:', error);
    return c.json({ error: 'Failed to extract article content.', code: 'EXTRACTION_FAILED' }, 500);
  }
});

export default app;
