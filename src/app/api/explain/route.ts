import { NextRequest, NextResponse } from 'next/server';
import { client } from '@/lib/server/anthropic';

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

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Break down this Afrikaans sentence for a language learner. Explain each word, its role in the sentence, and any grammar points. Keep it concise but educational. Focus especially on the word "${clozeWord}" since that's the word being studied.

Sentence: "${sentence}"
Translation: "${translation}"
Study word: "${clozeWord}"`,
        },
      ],
    });

    const text =
      message.content[0].type === 'text' ? message.content[0].text : '';

    return NextResponse.json({ explanation: text });
  } catch (error) {
    console.error('Error generating explanation:', error);
    return NextResponse.json(
      { error: 'Failed to generate explanation' },
      { status: 500 }
    );
  }
}
