import { NextRequest, NextResponse } from 'next/server';
import { cacheAcceptedEntry, type CacheAcceptedInput } from '@/lib/server/dictionary-db';

/**
 * POST /api/dictionary/cache
 *
 * Persists a user-accepted AI translation into the on-device cache. Called
 * from the read page when the user saves a word to vocab, marks it Known,
 * or sets a learning level — actions that signal "this translation is good
 * enough that I'm committing to the word".
 *
 * Body: CacheAcceptedInput  (word + senses required; ipa/etymology/related
 * forms / sourceSentence / language optional)
 *
 * Returns: { word: string } on success, or { error } on bad input.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<CacheAcceptedInput>;
    if (!body.word || typeof body.word !== 'string' || !body.word.trim()) {
      return NextResponse.json({ error: 'Word is required' }, { status: 400 });
    }
    if (!Array.isArray(body.senses) || body.senses.length === 0) {
      return NextResponse.json({ error: 'At least one sense is required' }, { status: 400 });
    }

    const word = cacheAcceptedEntry({
      word: body.word,
      senses: body.senses,
      ipa: body.ipa,
      etymology: body.etymology,
      relatedForms: body.relatedForms,
      sourceSentence: body.sourceSentence,
      language: body.language,
    });

    if (!word) {
      return NextResponse.json({ error: 'Nothing to cache' }, { status: 400 });
    }
    return NextResponse.json({ word });
  } catch (err) {
    console.error('Dictionary cache write error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cache write failed' },
      { status: 500 },
    );
  }
}
