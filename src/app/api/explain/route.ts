import { NextRequest, NextResponse } from 'next/server';
import { prompt as askClaude } from '@/lib/server/anthropic';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { sentence, translation, clozeWord } = await request.json();

    if (!sentence || !translation) {
      return NextResponse.json(
        { error: 'sentence and translation are required' },
        { status: 400 }
      );
    }

    const text = await askClaude(
      `Break down this Afrikaans sentence for a language learner. Explain each word, its role in the sentence, and any grammar points. Keep it concise but educational. Focus especially on the word "${clozeWord}" since that's the word being studied.

Sentence: "${sentence}"
Translation: "${translation}"
Study word: "${clozeWord}"`,
      1024,
      'haiku'
    );

    return NextResponse.json({ explanation: text });
  } catch (error) {
    console.error('Error generating explanation:', error);
    return NextResponse.json(
      { error: 'Failed to generate explanation' },
      { status: 500 }
    );
  }
}
