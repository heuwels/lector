import { Hono } from 'hono';
import https from 'node:https';
import { LANGUAGES } from '../lib/languages';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';

interface TatoebaApiSentence {
  id: number;
  text: string;
  lang: string;
  translations: { id: number; text: string; lang: string }[][];
}

interface TatoebaSearchResult {
  paging: {
    Sentences: {
      count: number;
      pageCount: number;
    };
  };
  results: TatoebaApiSentence[];
}

// Custom fetch via node:https with IPv4 forced (avoids connectivity issues).
function fetchTatoeba(path: string): Promise<TatoebaSearchResult> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'tatoeba.org',
      path: `/en/api_v0${path}`,
      method: 'GET',
      family: 4, // Force IPv4
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Lector/1.0',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid JSON response from Tatoeba'));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

const app = new Hono();

// GET /api/tatoeba
app.get('/', async (c) => {
  const limit = c.req.query('limit') || '20';
  const query = c.req.query('query');
  const lang = resolveLanguage(c.req.query('language'), getCurrentUserId(c));

  const params = new URLSearchParams({
    from: LANGUAGES[lang].tatoebaCode,
    to: 'eng',
    sort: query ? 'relevance' : 'random',
    limit: Math.min(parseInt(limit), 100).toString(),
  });

  if (query) {
    params.set('query', query);
  }

  try {
    const data = await fetchTatoeba(`/search?${params.toString()}`);

    const sentences = data.results.map((sentence) => {
      const englishTranslation = sentence.translations.flat().find((t) => t.lang === 'eng');

      return {
        id: sentence.id,
        text: sentence.text,
        lang: sentence.lang,
        translation: englishTranslation
          ? {
              id: englishTranslation.id,
              text: englishTranslation.text,
              lang: englishTranslation.lang,
            }
          : undefined,
      };
    });

    return c.json({ sentences });
  } catch (error) {
    console.error('Tatoeba API error:', error);

    if (error instanceof Error) {
      if (error.message === 'Request timeout') {
        return c.json({ error: 'Request to Tatoeba timed out. Please try again.' }, 504);
      }
      return c.json({ error: `Tatoeba error: ${error.message}` }, 500);
    }

    return c.json({ error: 'Failed to fetch from Tatoeba' }, 500);
  }
});

export default app;
