import { getProvider, parseLooseJson } from './llm';
import { resolveLanguage } from './active-language';
import { getLanguageConfig } from './languages';

/**
 * Run the LLM journal-correction over a piece of text. Shared by the
 * /api/journal-correct route and the /api/journal/:id/correct flow.
 */
export async function correctJournalText(
  userId: string,
  body: string,
  language?: string,
): Promise<Record<string, unknown>> {
  const lang = resolveLanguage(language, userId);
  const langName = getLanguageConfig(lang).name;

  const provider = getProvider(userId);
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
    responseFormat: 'json',
  });

  return parseLooseJson<Record<string, unknown>>(text);
}
