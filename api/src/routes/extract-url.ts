import { Hono } from 'hono';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { htmlToMarkdown, countWords } from '../lib/html-to-markdown';

const app = new Hono();

// POST /api/extract-url
app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return c.json({ error: 'URL is required', code: 'INVALID_URL' }, 400);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      return c.json({ error: 'Please enter a valid URL', code: 'INVALID_URL' }, 400);
    }

    let html: string;
    try {
      const response = await fetch(parsedUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5,af;q=0.3',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return c.json({ error: `Could not fetch the page (HTTP ${response.status})`, code: 'FETCH_FAILED' }, 400);
      }

      const contentType = response.headers.get('content-type') || '';
      const charsetMatch = contentType.match(/charset=([^;]+)/i);

      if (charsetMatch) {
        const charset = charsetMatch[1].trim().toLowerCase();
        if (charset !== 'utf-8') {
          const buffer = await response.arrayBuffer();
          const decoder = new TextDecoder(charset);
          html = decoder.decode(buffer);
        } else {
          html = await response.text();
        }
      } else {
        html = await response.text();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('timeout') || message.includes('aborted')) {
        return c.json({ error: 'Request timed out. The page took too long to load.', code: 'FETCH_FAILED' }, 400);
      }
      return c.json({ error: 'Could not fetch the page. Check the URL and try again.', code: 'FETCH_FAILED' }, 400);
    }

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
      title: article.title || parsedUrl.hostname,
      author,
      content: markdownContent,
      siteName: article.siteName || parsedUrl.hostname,
      excerpt: article.excerpt || null,
      wordCount: countWords(markdownContent),
    });
  } catch (error) {
    console.error('Error extracting article:', error);
    return c.json({ error: 'Failed to extract article content.', code: 'EXTRACTION_FAILED' }, 500);
  }
});

export default app;
