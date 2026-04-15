import { NextRequest, NextResponse } from 'next/server';
import { prompt as askClaude } from '@/lib/server/anthropic';
import { db } from '@/lib/server/database';

function recordStudyPing() {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO dailyStats
      (date, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
    VALUES (?, 0, 0, 0, 0, 0, 0, 0)
  `).run(today);
  db.prepare(`
    UPDATE dailyStats SET sessionStartedAt = COALESCE(sessionStartedAt, ?) WHERE date = ?
  `).run(now, today);
}

export async function POST(request: NextRequest) {
  try {
    const { word, sentence, type = 'word' } = await request.json();

    if (!word) {
      return NextResponse.json({ error: 'Word is required' }, { status: 400 });
    }

    recordStudyPing();

    if (type === 'phrase') {
      // Phrase translation
      const prompt = `You are an Afrikaans to English translator. Translate the following Afrikaans phrase, using the sentence context to determine the correct meaning.

Phrase: "${word}"
Sentence context: "${sentence || word}"

Respond with ONLY a JSON object in this exact format (no markdown, no code blocks):
{"translation": "the natural English translation", "literalBreakdown": "word-by-word literal translation", "idiomaticMeaning": "explanation if this is an idiom or has special meaning"}

Include literalBreakdown if the phrase is more than one word.
Include idiomaticMeaning only if the phrase is an idiom or has a meaning that differs from the literal translation.`;

      const responseText = await askClaude(prompt, 512, 'haiku');
      const result = JSON.parse(responseText);
      return NextResponse.json(result);
    } else {
      // Word translation
      const prompt = `You are an Afrikaans to English translator. Translate the following Afrikaans word, using the sentence context to determine the correct meaning.

Word: "${word}"
Sentence context: "${sentence || word}"

Respond with ONLY a JSON object in this exact format (no markdown, no code blocks):
{"translation": "the English translation", "partOfSpeech": "noun/verb/adjective/adverb/etc"}

If you cannot determine the part of speech, omit that field.`;

      const responseText = await askClaude(prompt, 256, 'haiku');
      const result = JSON.parse(responseText);
      return NextResponse.json(result);
    }
  } catch (error) {
    console.error('Translation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Translation failed' },
      { status: 500 }
    );
  }
}
