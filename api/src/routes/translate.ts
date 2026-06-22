import { Hono } from 'hono';
import { streamText } from 'hono/streaming';
import { getProvider, parseLooseJson } from '../lib/llm';
import { getSpelreelsContext } from '../lib/spelreels';
import { resolveLanguage } from '../lib/active-language';
import { getLanguageConfig } from '../lib/languages';
import { buildGlossPrompt, buildWordEntryPrompt, buildPhrasePrompt } from '../lib/translate-prompts';

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

// Parse a rich word-entry response and stitch the legacy translation/partOfSpeech
// fields so existing call sites that only read those don't have to change.
function stitchWordEntry(text: string, fallbackWord: string) {
  const entry = parseLooseJson(text) as {
    word?: string;
    senses?: Array<{ partOfSpeech: string; gloss: string }>;
    ipa?: string;
    etymology?: string;
    relatedForms?: Array<{ form: string; relation: string }>;
  };

  const senses: Array<{ partOfSpeech: string; gloss: string }> = Array.isArray(entry.senses) ? entry.senses : [];
  const stitchedTranslation = senses.map((s) => s.gloss).filter(Boolean).join('; ');

  return {
    translation: stitchedTranslation,
    partOfSpeech: senses[0]?.partOfSpeech,
    word: entry.word || fallbackWord,
    senses,
    ipa: entry.ipa,
    etymology: entry.etymology,
    relatedForms: Array.isArray(entry.relatedForms) ? entry.relatedForms : undefined,
  };
}

// Shared handler for the structured word entry — used by POST / (type=word) and
// POST /enrich. Throws on provider/JSON failure; callers wrap in try/catch.
async function buildWordEntryResponse(langName: string, word: string, sentence: string) {
  const provider = getProvider();
  const text = await provider.complete({
    messages: [{ role: 'user', content: buildWordEntryPrompt(langName, word, sentence) }],
    maxTokens: 1500,
    task: 'word-translation',
    responseFormat: 'json',
  });
  return stitchWordEntry(text, word);
}

const app = new Hono();

// POST /api/translate/gloss — latency-critical fast path (single words only).
// Streams a plain-text gloss as it generates so the reader sees the meaning
// form token-by-token instead of waiting for a full structured response.
app.post('/gloss', async (c) => {
  const { word, sentence, language } = await c.req.json();
  if (!word) {
    return c.json({ error: 'Word is required' }, 400);
  }

  recordStudyPing();

  const lang = resolveLanguage(language);
  const langName = getLanguageConfig(lang).name;
  const prompt = buildGlossPrompt(langName, word, sentence || '');
  const provider = getProvider();

  // streamText commits a 200 the moment it starts, so a provider failure before
  // the first delta can't become a non-200. We log and end the stream; the
  // client treats an empty gloss as a failure and can retry / fall back to
  // /enrich. (Errors mid-stream are unavoidable over a committed response.)
  return streamText(c, async (stream) => {
    try {
      for await (const delta of provider.stream({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 200,
        task: 'word-translation',
      })) {
        await stream.write(delta);
      }
    } catch (err) {
      console.error('Gloss stream error:', err);
    }
  });
});

// POST /api/translate/enrich — opt-in rich dictionary entry for a word the user
// already glossed. Off the critical path, so it stays non-streamed JSON. No
// study ping: the originating /gloss call already counted this lookup.
app.post('/enrich', async (c) => {
  try {
    const { word, sentence, language } = await c.req.json();
    if (!word) {
      return c.json({ error: 'Word is required' }, 400);
    }
    const lang = resolveLanguage(language);
    const langName = getLanguageConfig(lang).name;
    return c.json(await buildWordEntryResponse(langName, word, sentence || ''));
  } catch (error) {
    console.error('Enrich error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Enrich failed' }, 500);
  }
});

// POST /api/translate — original endpoint. Phrases use the spelreels-aware
// phrase prompt; words return the rich structured entry (now spelreels-free).
// Kept for in-context / re-translate callers and back-compat.
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

    if (type === 'phrase') {
      const spelreels = lang === 'af' ? getSpelreelsContext() : '';
      const spelreelsSection = spelreels
        ? `Use the following official spelling rules to inform your understanding of the ${langName} input:\n\n${spelreels}\n\n---\n\n`
        : '';

      const provider = getProvider();
      const text = await provider.complete({
        messages: [{ role: 'user', content: buildPhrasePrompt(langName, spelreelsSection, word, sentence || '') }],
        maxTokens: 1500,
        task: 'phrase-translation',
        responseFormat: 'json',
      });

      return c.json(parseLooseJson<Record<string, unknown>>(text));
    }

    return c.json(await buildWordEntryResponse(langName, word, sentence || ''));
  } catch (error) {
    console.error('Translation error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Translation failed' },
      500
    );
  }
});

export default app;
