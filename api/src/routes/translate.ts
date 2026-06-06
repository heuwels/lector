import { Hono } from 'hono';
import { getProvider } from '../lib/llm';
import { getSpelreelsContext } from '../lib/spelreels';
import { resolveLanguage } from '../lib/active-language';
import { getLanguageConfig } from '../lib/languages';

import { db } from '../db';

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
    const { word, sentence, type = 'word', language } = await c.req.json();

    if (!word) {
      return c.json({ error: 'Word is required' }, 400);
    }

    recordStudyPing();

    const lang = resolveLanguage(language);
    const langConfig = getLanguageConfig(lang);
    const langName = langConfig.name;

    const spelreels = lang === 'af' ? getSpelreelsContext() : '';
    const spelreelsSection = spelreels ? `Use the following official spelling rules to inform your understanding of the ${langName} input:\n\n${spelreels}\n\n---\n\n` : '';

    if (type === 'phrase') {
      const prompt = `You are a ${langName} to English translator with deep knowledge of ${langName} orthography, idiom, and register.

${spelreelsSection}A learner has selected a ${langName} phrase from a text they're reading. Help them understand it the way a native speaker would — not just what the words say, but what the phrase actually means, why it's phrased this way, and when it would be used.

Phrase: "${word}"
Sentence context: "${sentence || word}"

Respond with ONLY a JSON object in this exact format (no markdown, no code blocks):
{
  "translation": "the most natural English translation a fluent speaker would use",
  "literalBreakdown": "word-by-word literal gloss (e.g. \\"hand-shoe\\" for handskoen)",
  "idiomaticMeaning": "if the phrase is an idiom, fixed expression, or compound: what it actually means and why — e.g. \\"This is an idiom which literally means X. It is used when ...\\"",
  "usageNotes": "register, tone, formality, or contextual notes a learner should know (e.g. \\"informal\\", \\"used by older speakers\\", \\"often sarcastic\\", \\"common in Bible-influenced Afrikaans\\")",
  "register": "formal | informal | literary | colloquial | archaic | neutral"
}

Required fields: translation. All other fields are optional — only include them when they add real value:
- Include literalBreakdown if the phrase is more than one word AND the literal gloss differs from the natural translation in an interesting way.
- Include idiomaticMeaning ALWAYS for idioms, fixed expressions, sayings, proverbs, or compound words whose meaning isn't obvious from the parts. Explain like a teacher would.
- Include usageNotes when the phrase carries register / tone / cultural baggage the learner couldn't infer from the dictionary.
- Include register if you're confident; omit if neutral or unclear.

Be specific and concrete in idiomaticMeaning and usageNotes — avoid vague phrases like "commonly used" or "has a special meaning".`;

      const provider = getProvider();
      const text = await provider.complete({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 800,
      });

      return c.json(JSON.parse(text));
    } else {
      const prompt = `You are a ${langName} to English translator with deep knowledge of ${langName} orthography.

${spelreelsSection}Translate the following ${langName} word, using the sentence context to determine the correct meaning.

Word: "${word}"
Sentence context: "${sentence || word}"

Respond with ONLY a JSON object in this exact format (no markdown, no code blocks):
{"translation": "the English translation", "partOfSpeech": "noun/verb/adjective/adverb/etc"}

If you cannot determine the part of speech, omit that field.`;

      const provider = getProvider();
      const text = await provider.complete({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 256,
      });

      return c.json(JSON.parse(text));
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
