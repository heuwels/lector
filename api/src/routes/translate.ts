import { Hono } from 'hono';
import { getProvider, parseLooseJson } from '../lib/llm';
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
        task: 'phrase-translation',
        responseFormat: 'json',
      });

      return c.json(parseLooseJson<Record<string, unknown>>(text));
    } else {
      const prompt = `You are a ${langName} to English translator with deep knowledge of ${langName} orthography, morphology, and etymology.

${spelreelsSection}A learner clicked the following ${langName} word while reading. Produce a dictionary-quality entry — not a single gloss. The output is used both to display the meaning AND to persist into an on-device dictionary, so be thorough and faithful.

Word: "${word}"
Sentence context: "${sentence || word}"

Respond with ONLY a JSON object in this exact shape (no markdown, no code blocks):
{
  "word": "${word}",
  "senses": [
    { "partOfSpeech": "noun | verb | adjective | adverb | pronoun | preposition | conjunction | interjection | determiner | numeral | particle", "gloss": "concise English meaning, no period" }
    /* ...one entry per distinct sense; order most-common first */
  ],
  "ipa": "/.../ or [...] — phonetic transcription if you're confident",
  "etymology": "Brief origin note (e.g. \\"From Dutch X, from Middle Dutch Y\\")",
  "relatedForms": [
    { "form": "the related word", "relation": "plural of | diminutive of | past tense of | derived from | etc." }
  ]
}

Rules:
- "word" and "senses" are REQUIRED. senses must be non-empty.
- Include separate sense entries for genuinely distinct meanings (e.g. "trek" = pull / move / journey). Don't split shades of the same meaning.
- Use the sentence to bias sense ORDER, but include all common senses a learner might reasonably encounter.
- Each gloss is a short English phrase (1-4 words is typical, up to a clause for verbs with idiomatic completions).
- Omit ipa / etymology / relatedForms entirely if you're not confident — don't guess.
- Use the same partOfSpeech vocabulary as Wiktionary so cached entries align with the curated dict.

Backwards-compat fields the server adds (do NOT include these yourself — server stitches them from senses): translation, partOfSpeech.`;

      const provider = getProvider();
      const text = await provider.complete({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 800,
        task: 'word-translation',
        responseFormat: 'json',
      });

      const entry = parseLooseJson(text) as {
        word?: string;
        senses?: Array<{ partOfSpeech: string; gloss: string }>;
        ipa?: string;
        etymology?: string;
        relatedForms?: Array<{ form: string; relation: string }>;
      };

      // Stitch legacy fields so existing call sites that only read translation +
      // partOfSpeech don't have to change.
      const senses: Array<{ partOfSpeech: string; gloss: string }> = Array.isArray(entry.senses) ? entry.senses : [];
      const stitchedTranslation = senses.map((s) => s.gloss).filter(Boolean).join('; ');
      const firstPos = senses[0]?.partOfSpeech;

      return c.json({
        translation: stitchedTranslation,
        partOfSpeech: firstPos,
        // Pass through the structured fields
        word: entry.word || word,
        senses,
        ipa: entry.ipa,
        etymology: entry.etymology,
        relatedForms: Array.isArray(entry.relatedForms) ? entry.relatedForms : undefined,
      });
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
