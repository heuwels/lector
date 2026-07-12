import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamText } from 'hono/streaming';
import {
  completeJson,
  getProvider,
  type LLMProvider,
  type LLMTask,
  type ProviderAccessOptions,
} from '../lib/llm';
import { getSpelreelsContext } from '../lib/spelreels';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { getLanguageConfig } from '../lib/languages';
import {
  buildGlossPrompt,
  buildPhrasePrompt,
  buildSimpleContextPrompt,
  buildSimplePhrasePrompt,
  buildWordEntryPrompt,
} from '../lib/translate-prompts';
import { recordStudySessionPing } from '../lib/study-session';
import {
  entitlements,
  planLimitResponse,
  type EntitlementsEngine,
  type MeteredMetric,
  type ResolvedEntitlements,
  type UsageReservation,
} from '../lib/entitlements';
import {
  translationBurstLimiter,
  type TranslationBurstKind,
  type TranslationBurstLimiter,
} from '../lib/rate-limit';

const MAX_WORD_CHARS = 128;
const MAX_PHRASE_CHARS = 256;
const MAX_SENTENCE_CHARS = 1_000;
const MAX_LANGUAGE_CHARS = 64;
const MAX_TRANSLATION_BODY_BYTES = 16 * 1024;

interface TranslateRouteDeps {
  providerForUser: (userId: string, access: ProviderAccessOptions) => LLMProvider;
  engine: EntitlementsEngine;
  rateLimiter: TranslationBurstLimiter;
}

interface CommonInput {
  word: string;
  sentence: string;
  language?: string;
}

interface TranslationInput extends CommonInput {
  type: 'word' | 'phrase';
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readObject(c: Context): Promise<Parsed<Record<string, unknown>>> {
  try {
    const value: unknown = await c.req.json();
    return isRecord(value)
      ? { ok: true, value }
      : { ok: false, error: 'Request body must be a JSON object' };
  } catch {
    return { ok: false, error: 'Request body must be valid JSON' };
  }
}

function parseCommon(
  body: Record<string, unknown>,
  options: { oneToken: boolean; maxChars: number; label: 'Word' | 'Phrase' },
): Parsed<CommonInput> {
  if (typeof body.word !== 'string') {
    return { ok: false, error: `${options.label} must be a string` };
  }
  const word = body.word.trim();
  if (!word) return { ok: false, error: `${options.label} is required` };
  if (word.length > options.maxChars) {
    return { ok: false, error: `${options.label} is too long` };
  }
  if (options.oneToken && word.split(/\s+/u).length !== 1) {
    return { ok: false, error: `${options.label} must be a single token` };
  }

  if (body.sentence !== undefined && typeof body.sentence !== 'string') {
    return { ok: false, error: 'Sentence must be a string' };
  }
  const sentence = (body.sentence ?? '') as string;
  if (sentence.length > MAX_SENTENCE_CHARS) {
    return { ok: false, error: 'Sentence is too long' };
  }

  if (body.language !== undefined && typeof body.language !== 'string') {
    return { ok: false, error: 'Language must be a string' };
  }
  const language = body.language as string | undefined;
  if (language !== undefined && (language.length === 0 || language.length > MAX_LANGUAGE_CHARS)) {
    return { ok: false, error: 'Language is invalid' };
  }

  return { ok: true, value: { word, sentence, language } };
}

function parseSingleWord(body: Record<string, unknown>): Parsed<CommonInput> {
  return parseCommon(body, { oneToken: true, maxChars: MAX_WORD_CHARS, label: 'Word' });
}

function parseTranslation(body: Record<string, unknown>): Parsed<TranslationInput> {
  if (body.type !== 'word' && body.type !== 'phrase') {
    return { ok: false, error: 'Type must be exactly "word" or "phrase"' };
  }
  const common = parseCommon(body, {
    oneToken: body.type === 'word',
    maxChars: body.type === 'phrase' ? MAX_PHRASE_CHARS : MAX_WORD_CHARS,
    label: body.type === 'phrase' ? 'Phrase' : 'Word',
  });
  return common.ok ? { ok: true, value: { ...common.value, type: body.type } } : common;
}

function isManagedFree(resolved: ResolvedEntitlements): boolean {
  return resolved.plan === 'free' && !resolved.byok;
}

function metricForGloss(resolved: ResolvedEntitlements): MeteredMetric {
  // BYOK requests use only the high general abuse ceiling; they never consume
  // Lector-funded managed translation allowance.
  return resolved.byok ? 'llmRequestsPerMonth' : 'wordGlossesPerMonth';
}

function burstResponse(c: Context) {
  c.header('Retry-After', '60');
  return c.json({ error: 'rate_limited' as const, retryAfterSeconds: 60 }, 429);
}

function consumeFreeBurst(
  c: Context,
  limiter: TranslationBurstLimiter,
  resolved: ResolvedEntitlements,
  userId: string,
  kind: TranslationBurstKind,
): Response | null {
  if (!isManagedFree(resolved)) return null;
  return limiter.tryConsume(userId, kind) ? null : burstResponse(c);
}

function reserve(
  c: Context,
  engine: EntitlementsEngine,
  userId: string,
  metric: MeteredMetric,
): UsageReservation | Response {
  const verdict = engine.reserve(userId, metric);
  return verdict.allowed ? verdict.reservation : planLimitResponse(c, verdict);
}

function simpleTranslation(text: string): string {
  const translation = text.trim();
  if (!translation) throw new Error('Translation provider returned an empty response');
  if (translation.length > 512) throw new Error('Translation provider returned too much text');
  return translation;
}

// Parse a rich word-entry response and stitch the legacy translation/partOfSpeech
// fields so existing call sites that only read those don't have to change.
function stitchWordEntry(
  entry: {
    word?: string;
    senses?: Array<{ partOfSpeech: string; gloss: string }>;
    ipa?: string;
    etymology?: string;
    relatedForms?: Array<{ form: string; relation: string }>;
  },
  fallbackWord: string,
) {
  const senses: Array<{ partOfSpeech: string; gloss: string }> = Array.isArray(entry.senses)
    ? entry.senses
    : [];
  const stitchedTranslation = senses
    .map((sense) => sense.gloss)
    .filter(Boolean)
    .join('; ');

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

async function buildWordEntryResponse(
  provider: LLMProvider,
  task: Extract<LLMTask, 'word-enrichment' | 'context-rich'>,
  langName: string,
  word: string,
  sentence: string,
) {
  const entry = await completeJson<{
    word?: string;
    senses?: Array<{ partOfSpeech: string; gloss: string }>;
    ipa?: string;
    etymology?: string;
    relatedForms?: Array<{ form: string; relation: string }>;
  }>(provider, {
    messages: [{ role: 'user', content: buildWordEntryPrompt(langName, word, sentence) }],
    maxTokens: 1500,
    task,
  });
  return stitchWordEntry(entry, word);
}

export function makeTranslateRoutes({
  providerForUser,
  engine,
  rateLimiter,
}: TranslateRouteDeps): Hono {
  const app = new Hono();
  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_TRANSLATION_BODY_BYTES,
      onError: (c) => c.json({ error: 'Translation request is too large' }, 413),
    }),
  );

  // Latency-critical residual dictionary miss. Curated/on-device hits never
  // reach this endpoint and remain unmetered.
  app.post('/gloss', async (c) => {
    const parsedBody = await readObject(c);
    if (!parsedBody.ok) return c.json({ error: parsedBody.error }, 400);
    const parsed = parseSingleWord(parsedBody.value);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const userId = getCurrentUserId(c);
    const resolved = engine.resolveEntitlements(userId);
    const burst = consumeFreeBurst(c, rateLimiter, resolved, userId, 'gloss');
    if (burst) return burst;

    const lang = resolveLanguage(parsed.value.language, userId);
    const langName = getLanguageConfig(lang).name;
    const prompt = buildGlossPrompt(langName, parsed.value.word, parsed.value.sentence);
    recordStudySessionPing(userId, lang);

    const reservation = reserve(c, engine, userId, metricForGloss(resolved));
    if (reservation instanceof Response) return reservation;

    let provider: LLMProvider;
    try {
      provider = providerForUser(userId, { byok: reservation.byok });
    } catch (error) {
      engine.refund(reservation);
      console.error('Gloss provider error:', error);
      return c.json({ error: 'Translation failed' }, 500);
    }

    return streamText(c, async (stream) => {
      let output = '';
      try {
        for await (const delta of provider.stream({
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 32,
          task: 'word-gloss',
        })) {
          output += delta;
          await stream.write(delta);
        }
        if (!output.trim()) engine.refund(reservation);
      } catch (error) {
        if (!output.trim()) engine.refund(reservation);
        console.error('Gloss stream error:', error);
      }
    });
  });

  // Paid or user-funded opt-in dictionary enrichment. Managed Free has a zero
  // shared-LLM allowance, so it is rejected before provider construction.
  app.post('/enrich', async (c) => {
    const parsedBody = await readObject(c);
    if (!parsedBody.ok) return c.json({ error: parsedBody.error }, 400);
    const parsed = parseSingleWord(parsedBody.value);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const userId = getCurrentUserId(c);
    const lang = resolveLanguage(parsed.value.language, userId);
    const langName = getLanguageConfig(lang).name;
    const reservation = reserve(c, engine, userId, 'llmRequestsPerMonth');
    if (reservation instanceof Response) return reservation;

    try {
      const entry = await buildWordEntryResponse(
        providerForUser(userId, { byok: reservation.byok }),
        'word-enrichment',
        langName,
        parsed.value.word,
        parsed.value.sentence,
      );
      return c.json(entry);
    } catch (error) {
      engine.refund(reservation);
      console.error('Enrich error:', error);
      return c.json({ error: error instanceof Error ? error.message : 'Enrich failed' }, 500);
    }
  });

  app.post('/', async (c) => {
    const parsedBody = await readObject(c);
    if (!parsedBody.ok) return c.json({ error: parsedBody.error }, 400);
    const parsed = parseTranslation(parsedBody.value);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const { word, sentence, language, type } = parsed.value;
    const userId = getCurrentUserId(c);
    const resolved = engine.resolveEntitlements(userId);
    const managedFree = isManagedFree(resolved);

    if (type === 'phrase') {
      const phraseWords = word.split(/\s+/u).length;
      const phraseVerdict = engine.checkLimit(userId, 'phraseSelectionWords', phraseWords);
      if (!phraseVerdict.allowed) return planLimitResponse(c, phraseVerdict);
    }

    const burst = consumeFreeBurst(c, rateLimiter, resolved, userId, 'detail');
    if (burst) return burst;

    const lang = resolveLanguage(language, userId);
    const langConfig = getLanguageConfig(lang);
    const langName = langConfig.name;
    recordStudySessionPing(userId, lang);

    const metric: MeteredMetric = managedFree
      ? type === 'phrase'
        ? 'phraseTranslationsPerDay'
        : 'contextTranslationsPerDay'
      : 'llmRequestsPerMonth';
    const reservation = reserve(c, engine, userId, metric);
    if (reservation instanceof Response) return reservation;

    try {
      const provider = providerForUser(userId, { byok: reservation.byok });
      if (managedFree && type === 'phrase') {
        const translation = simpleTranslation(
          await provider.complete({
            messages: [
              {
                role: 'user',
                content: buildSimplePhrasePrompt(langName, word, sentence),
              },
            ],
            maxTokens: 48,
            task: 'phrase-simple',
          }),
        );
        return c.json({ translation });
      }

      if (managedFree) {
        const translation = simpleTranslation(
          await provider.complete({
            messages: [
              {
                role: 'user',
                content: buildSimpleContextPrompt(langName, word, sentence),
              },
            ],
            maxTokens: 48,
            task: 'context-simple',
          }),
        );
        return c.json({ translation });
      }

      if (type === 'phrase') {
        const spelreels = lang === 'af' ? getSpelreelsContext() : '';
        const spelreelsSection = spelreels
          ? `Use the following official spelling rules to inform your understanding of the ${langName} input:\n\n${spelreels}\n\n---\n\n`
          : '';
        const result = await completeJson<Record<string, unknown>>(provider, {
          messages: [
            {
              role: 'user',
              content: buildPhrasePrompt(langName, spelreelsSection, word, sentence),
            },
          ],
          maxTokens: 1500,
          task: 'phrase-rich',
        });
        return c.json(result);
      }

      const entry = await buildWordEntryResponse(
        provider,
        'context-rich',
        langName,
        word,
        sentence,
      );
      return c.json(entry);
    } catch (error) {
      engine.refund(reservation);
      console.error('Translation error:', error);
      return c.json({ error: error instanceof Error ? error.message : 'Translation failed' }, 500);
    }
  });

  return app;
}

export default makeTranslateRoutes({
  providerForUser: getProvider,
  engine: entitlements,
  rateLimiter: translationBurstLimiter,
});
