import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const app = new Hono();

// POST /api/explain
app.post('/', async (c) => {
  try {
    const { sentence, translation, clozeWord } = await c.req.json();

    if (!sentence || !translation) {
      return c.json({ error: 'sentence and translation are required' }, 400);
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

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    return c.json({ explanation: text });
  } catch (error) {
    console.error('Error generating explanation:', error);
    return c.json({ error: 'Failed to generate explanation' }, 500);
  }
});

export default app;
