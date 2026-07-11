// Background word→domain classifier. Takes a batch of known words (with optional
// translation / example context) and asks an LLM to assign each one a single
// topic domain from the fixed taxonomy in ./domains. The driver in production is
// the classify-worker; tests call this directly with a mocked provider.
//
// Design notes:
//  - The prompt is the single enforcement point for JSON: no OpenAI-compatible
//    backend honours `response_format` uniformly (LM Studio 400s on json_object,
//    Ollama ignores json_schema), so we instruct JSON in the prompt and read it
//    back with parseLooseJson() — which also strips the <think>…</think> blocks
//    that reasoning models common in LM Studio emit. We never rely on JSON mode.
//  - Validation is strict-but-lenient: out-of-enum, hallucinated, or unparseable
//    results are dropped, never guessed. A dropped word keeps domain IS NULL and
//    is retried on the next sweep — far safer than a wrong tag, since a word's
//    domain is never reclassified once set.

import { DOMAINS, GENERAL, isClassifiedDomain, type ClassifiedDomain } from './domains';
import {
  completeJson,
  getClassificationProvider,
  LLMInvalidJsonError,
  type LLMProvider,
} from './llm';

export interface ClassifyItem {
  word: string;
  /** English gloss — the cross-language anchor; lets a local model place a word it doesn't know. */
  translation?: string;
  /** An example sentence, used only to disambiguate the intended sense. */
  sentence?: string;
}

export interface ClassifyResult {
  word: string;
  domain: ClassifiedDomain;
}

/**
 * Build the enum-constrained, batched prompt. The per-domain `scope` strings in
 * DOMAINS double as the classifier hints, so the taxonomy stays the single
 * source of truth — add a domain there and the prompt updates for free.
 */
function buildPrompt(items: ClassifyItem[]): string {
  const domainLines = DOMAINS.map((d) => `- ${d.key}: ${d.scope}`).join('\n');
  const wordLines = items
    .map((it, i) => {
      const parts = [`${i + 1}. "${it.word}"`];
      if (it.translation) parts.push(`translation: "${it.translation}"`);
      if (it.sentence) parts.push(`example: "${it.sentence}"`);
      return parts.join(' — ');
    })
    .join('\n');

  return `You are a lexical domain classifier. For each word below, choose the ONE topic domain its meaning most belongs to.

Domains:
${domainLines}
- ${GENERAL}: topic-neutral, high-frequency, or function/core words that belong to no specific topic (e.g. "the", "very", "think", "important", "water")

Rules:
- Pick exactly one domain key per word, taken verbatim from the list above.
- Classify the word's own core meaning. Use the example sentence only to disambiguate which sense is meant — never to inherit the sentence's overall topic.
- Use "${GENERAL}" for function words, very common core vocabulary, or anything topic-neutral.
- Respond with ONLY a JSON array — no markdown, no commentary:
  [{"word": "<word>", "domain": "<key>"}]
- One object per input word, in the same order, with the word spelled exactly as given.

Words:
${wordLines}`;
}

/**
 * Classify a batch of words into topic domains. Returns one entry per word that
 * was confidently assigned a valid domain; words the model omitted, hallucinated,
 * or tagged out-of-enum are simply absent (left for the next sweep). Provider /
 * network errors propagate — the caller (worker) decides how to back off.
 */
export async function classifyWords(
  items: ClassifyItem[],
  provider: LLMProvider = getClassificationProvider(),
): Promise<ClassifyResult[]> {
  if (items.length === 0) return [];

  // The JSON itself is tiny (~20 tokens/word), but local reasoning models — the
  // LM Studio default — emit a <think> block first that can dwarf it. Too small a
  // budget truncates before the JSON and loses the whole batch, so keep a roomy
  // floor; CLASSIFY_MAX_TOKENS bumps it further for an especially chatty model.
  const envMax = parseInt(process.env.CLASSIFY_MAX_TOKENS || '', 10);
  const maxTokens = envMax > 0 ? envMax : Math.min(8192, Math.max(2048, items.length * 64));
  // Normalised input word → exact stored spelling, so the returned domain UPDATEs
  // the right knownWords row no matter how the model re-cased/echoed the word.
  const byNormalised = new Map<string, string>();
  for (const it of items) byNormalised.set(it.word.trim().toLowerCase(), it.word);

  let parsed: unknown[];
  try {
    parsed = await completeJson<unknown[]>(provider, {
      messages: [{ role: 'user', content: buildPrompt(items) }],
      maxTokens,
      // Classification already retries on the next worker sweep. Keep one
      // immediate recovery attempt, but never request more than 8192 output
      // tokens in a single call (or lower an explicit larger first budget).
      maxRetryTokens: Math.max(maxTokens, 8192),
      task: 'word-classification',
      responseFormat: 'json-array',
    });
  } catch (error) {
    // Whole-response garbage: classify nothing this round (retried next sweep).
    if (error instanceof LLMInvalidJsonError) return [];
    throw error;
  }
  const assigned = new Map<string, ClassifiedDomain>(); // exact word → domain, first valid wins
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const rawWord = (entry as { word?: unknown }).word;
    const rawDomain = (entry as { domain?: unknown }).domain;
    if (typeof rawWord !== 'string' || typeof rawDomain !== 'string') continue;

    const exact = byNormalised.get(rawWord.trim().toLowerCase());
    if (!exact || assigned.has(exact)) continue; // hallucinated word, or already set

    const domain = rawDomain.trim().toLowerCase().replace(/\s+/g, '_');
    if (!isClassifiedDomain(domain)) continue; // out-of-enum → drop, retried next sweep

    assigned.set(exact, domain);
  }

  // Emit in input order (deterministic), de-duping any repeated input word.
  const emitted = new Set<string>();
  const results: ClassifyResult[] = [];
  for (const it of items) {
    if (emitted.has(it.word)) continue;
    const domain = assigned.get(it.word);
    if (domain) {
      results.push({ word: it.word, domain });
      emitted.add(it.word);
    }
  }
  return results;
}
