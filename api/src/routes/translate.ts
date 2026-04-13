import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';

const client = new Anthropic();

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

const app = new Hono();

// POST /api/translate
app.post('/', async (c) => {
  try {
    const { word, sentence, type = 'word' } = await c.req.json();

    if (!word) {
      return c.json({ error: 'Word is required' }, 400);
    }

    recordStudyPing();

    if (type === 'phrase') {
      const prompt = `You are an Afrikaans to English translator. Translate the following Afrikaans phrase, using the sentence context to determine the correct meaning.

Phrase: "${word}"
Sentence context: "${sentence || word}"

Respond with ONLY a JSON object in this exact format (no markdown, no code blocks):
{"translation": "the natural English translation", "literalBreakdown": "word-by-word literal translation", "idiomaticMeaning": "explanation if this is an idiom or has special meaning"}

Include literalBreakdown if the phrase is more than one word.
Include idiomaticMeaning only if the phrase is an idiom or has a meaning that differs from the literal translation.`;

      const message = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = message.content[0];
      if (content.type !== 'text') {
        return c.json({ error: 'Unexpected response type' }, 500);
      }

      return c.json(JSON.parse(content.text));
    } else {
      const prompt = `You are an Afrikaans to English translator. Translate the following Afrikaans word, using the sentence context to determine the correct meaning.

Word: "${word}"
Sentence context: "${sentence || word}"

Respond with ONLY a JSON object in this exact format (no markdown, no code blocks):
{"translation": "the English translation", "partOfSpeech": "noun/verb/adjective/adverb/etc"}

If you cannot determine the part of speech, omit that field.`;

      const message = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = message.content[0];
      if (content.type !== 'text') {
        return c.json({ error: 'Unexpected response type' }, 500);
      }

      return c.json(JSON.parse(content.text));
    }
  } catch (error) {
    console.error('Translation error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Translation failed' },
      500
    );
  }
});

export default app;
