import { NextRequest, NextResponse } from 'next/server';
import https from 'node:https';

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

// Custom fetch using https module with IPv4 forced
function fetchTatoeba(path: string): Promise<TatoebaSearchResult> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'tatoeba.org',
      path: `/en/api_v0${path}`,
      method: 'GET',
      family: 4, // Force IPv4 to avoid connectivity issues
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AfrikaansReader/1.0',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = searchParams.get('limit') || '20';
  const query = searchParams.get('query');

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

    // Transform the data to our simpler format
    const sentences = data.results.map((sentence) => {
      const englishTranslation = sentence.translations
        .flat()
        .find((t) => t.lang === 'eng');

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

    return NextResponse.json({ sentences });
  } catch (error) {
    console.error('Tatoeba API error:', error);

    if (error instanceof Error) {
      if (error.message === 'Request timeout') {
        return NextResponse.json(
          { error: 'Request to Tatoeba timed out. Please try again.' },
          { status: 504 }
        );
      }
      return NextResponse.json(
        { error: `Tatoeba error: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch from Tatoeba' },
      { status: 500 }
    );
  }
}
