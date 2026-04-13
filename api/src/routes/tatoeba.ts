import { Hono } from 'hono';

interface TatoebaApiSentence {
  id: number;
  text: string;
  lang: string;
  translations: { id: number; text: string; lang: string }[][];
}

interface TatoebaSearchResult {
  paging: { Sentences: { count: number; pageCount: number } };
  results: TatoebaApiSentence[];
}

async function fetchTatoeba(path: string): Promise<TatoebaSearchResult> {
  const response = await fetch(`https://tatoeba.org/en/api_v0${path}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Lector/1.0',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Tatoeba HTTP error: ${response.status}`);
  }

  return response.json();
}

const app = new Hono();

// GET /api/tatoeba
app.get('/', async (c) => {
  const limit = c.req.query('limit') || '20';
  const query = c.req.query('query');

  const params = new URLSearchParams({
    from: 'afr',
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
      const englishTranslation = sentence.translations
        .flat()
        .find((t) => t.lang === 'eng');

      return {
        id: sentence.id,
        text: sentence.text,
        lang: sentence.lang,
        translation: englishTranslation
          ? { id: englishTranslation.id, text: englishTranslation.text, lang: englishTranslation.lang }
          : undefined,
      };
    });

    return c.json({ sentences });
  } catch (error) {
    console.error('Tatoeba API error:', error);

    if (error instanceof Error) {
      if (error.message.includes('timeout') || error.message.includes('aborted')) {
        return c.json({ error: 'Request to Tatoeba timed out. Please try again.' }, 504);
      }
      return c.json({ error: `Tatoeba error: ${error.message}` }, 500);
    }

    return c.json({ error: 'Failed to fetch from Tatoeba' }, 500);
  }
});

export default app;
