import { Hono } from 'hono';
import { correctJournalText } from '../lib/journal-correct';
import { getCurrentUserId } from '../lib/user';

const app = new Hono();

// POST /api/journal-correct — correct a piece of text (no persistence).
app.post('/', async (c) => {
  try {
    const { body, language } = await c.req.json();

    if (!body?.trim()) {
      return c.json({ error: 'body is required' }, 400);
    }

    const result = await correctJournalText(getCurrentUserId(c), body, language);
    return c.json(result);
  } catch (error) {
    console.error('Journal correction error:', error);
    return c.json({ error: 'Correction failed' }, 500);
  }
});

export default app;
