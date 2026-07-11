import { Hono } from 'hono';
import { getProvider } from '../lib/llm';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { getLanguageConfig } from '../lib/languages';
import { entitlements, planLimitResponse } from '../lib/entitlements';

const app = new Hono();

// POST /api/explain
app.post('/', async (c) => {
  const userId = getCurrentUserId(c);
  let reservedLlm = false;
  try {
    const { sentence, translation, clozeWord, language } = await c.req.json();

    if (!sentence || !translation) {
      return c.json({ error: 'sentence and translation are required' }, 400);
    }

    // Reserve BEFORE the provider call, refund on failure (#222 review): a
    // check-then-record leaves a window where concurrent requests both pass.
    const llmVerdict = entitlements.reserve(userId, 'llmRequestsPerMonth');
    if (!llmVerdict.allowed) return planLimitResponse(c, llmVerdict);
    reservedLlm = true;

    const lang = resolveLanguage(language, userId);
    const langName = getLanguageConfig(lang).name;

    const provider = getProvider(userId);
    const text = await provider.complete({
      messages: [
        {
          role: 'user',
          content: `Break down this ${langName} sentence for a language learner. Explain each word, its role in the sentence, and any grammar points. Keep it concise but educational. Focus especially on the word "${clozeWord}" since that's the word being studied.

Sentence: "${sentence}"
Translation: "${translation}"
Study word: "${clozeWord}"`,
        },
      ],
      maxTokens: 1024,
    });

    reservedLlm = false; // the managed call happened — the usage is earned
    return c.json({ explanation: text });
  } catch (error) {
    if (reservedLlm) entitlements.refund(userId, 'llmRequestsPerMonth', 1);
    console.error('Error generating explanation:', error);
    return c.json({ error: 'Failed to generate explanation' }, 500);
  }
});

export default app;
