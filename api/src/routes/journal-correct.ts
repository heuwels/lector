import { Hono } from 'hono';
import { getProvider } from '../lib/llm';
import { resolveLanguage } from '../lib/active-language';
import { getLanguageConfig } from '../lib/languages';

const app = new Hono();

// POST /api/journal-correct
app.post('/', async (c) => {
  try {
    const { body, language } = await c.req.json();

    if (!body?.trim()) {
      return c.json({ error: 'body is required' }, 400);
    }

    const lang = resolveLanguage(language);
    const langName = getLanguageConfig(lang).name;

    const provider = getProvider();
    const text = await provider.complete({
      messages: [
        {
          role: 'user',
          content: `You are a ${langName} language tutor reviewing a student's journal entry. The student is an English speaker learning ${langName}.

Correct the following ${langName} text. For each error found, provide the correction and a brief explanation in English.

Student's text:
"""
${body}
"""

Respond with ONLY a JSON object in this exact format (no markdown, no code blocks):
{"correctedBody": "the full corrected text in ${langName}", "corrections": [{"original": "the incorrect word or phrase", "corrected": "the correct version", "explanation": "brief English explanation of why this is wrong and the rule", "type": "grammar|spelling|word_choice|word_order|missing_word|extra_word"}]}

If the text is perfect, return an empty corrections array.
Focus on: spelling errors, grammar (verb conjugation, tense, word order), word choice, missing or extra words, and idiomatic corrections.
Keep explanations concise (1-2 sentences) and educational.`,
        },
      ],
      maxTokens: 2048,
    });

    const result = JSON.parse(text);
    return c.json(result);
  } catch (error) {
    console.error('Journal correction error:', error);
    return c.json({ error: 'Correction failed' }, 500);
  }
});

export default app;
