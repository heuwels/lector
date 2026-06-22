/**
 * Prompt builders for the translation routes, kept in their own dependency-free
 * module (no DB, no provider) so they can be unit-tested as pure functions.
 *
 * The load-bearing invariant these encode: the spelreels (Afrikaans orthography
 * ruleset, ~3.3k tokens) is injected ONLY on the phrase path, never on a
 * single-word lookup. It used to ride along on every word translation and blew
 * past small local models' context windows for negligible gain.
 */

/**
 * Fast-path word gloss. Deliberately tiny: plain-text output (streamable, no
 * JSON to wait on), no spelreels, no IPA/etymology/related-forms. This is what
 * the reader sees the instant they click — the rich dictionary entry is a
 * separate opt-in "enrich" call.
 */
export function buildGlossPrompt(langName: string, word: string, sentence: string): string {
  return `You are a ${langName} to English translator. A learner clicked the word "${word}" while reading.
Sentence context: "${sentence || word}"

Reply with ONLY the concise English meaning — the natural translation(s), most common sense first, separated by "; ". No explanation, no quotes, no markdown, no extra words. If the word is an inflected form you may prefix a short tag like "(plural)" or "(past tense)". Keep it under ~12 words.`;
}

/**
 * Rich dictionary-quality word entry (senses + IPA + etymology + related forms).
 * Used by the opt-in "enrich" action and by legacy structured word lookups
 * (in-context / re-translate). No spelreels — the full orthography ruleset adds
 * thousands of tokens of latency for negligible gain on a single-word lookup.
 */
export function buildWordEntryPrompt(langName: string, word: string, sentence: string): string {
  return `You are a ${langName} to English translator with deep knowledge of ${langName} orthography, morphology, and etymology.

A learner clicked the following ${langName} word while reading. Produce a dictionary-quality entry — not a single gloss. The output is used both to display the meaning AND to persist into an on-device dictionary, so be thorough and faithful.

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
  "etymology": "Brief origin note (e.g. 'From Dutch X, from Middle Dutch Y')",
  "relatedForms": [
    { "form": "the related word", "relation": "plural of | diminutive of | past tense of | derived from | etc." }
  ]
}

Rules:
- "word" and "senses" are REQUIRED. senses must be non-empty.
- CRITICAL — valid JSON only: never put a double-quote character (") inside any string value. To quote a word, gloss, or cognate (common in etymology), use single quotes ('like this') or parentheses. A raw double quote inside a value breaks the JSON and the entry is discarded.
- Include separate sense entries for genuinely distinct meanings (e.g. trek = pull / move / journey). Don't split shades of the same meaning.
- Use the sentence to bias sense ORDER, but include all common senses a learner might reasonably encounter.
- Each gloss is a short English phrase (1-4 words is typical, up to a clause for verbs with idiomatic completions).
- Omit ipa / etymology / relatedForms entirely if you're not confident — don't guess.
- Use the same partOfSpeech vocabulary as Wiktionary so cached entries align with the curated dict.

Backwards-compat fields the server adds (do NOT include these yourself — server stitches them from senses): translation, partOfSpeech.`;
}

/**
 * Phrase / idiom translation. This path KEEPS the Afrikaans spelreels context
 * (passed in by the caller, af only) — idioms and fixed expressions genuinely
 * benefit from the orthography/register rules, and phrases are looked up far
 * less often than single words, so the extra tokens are an acceptable cost here.
 */
export function buildPhrasePrompt(langName: string, spelreelsSection: string, word: string, sentence: string): string {
  return `You are a ${langName} to English translator with deep knowledge of ${langName} orthography, idiom, and register.

${spelreelsSection}A learner has selected a ${langName} phrase from a text they're reading. Help them understand it the way a native speaker would — not just what the words say, but what the phrase actually means, why it's phrased this way, and when it would be used.

Phrase: "${word}"
Sentence context: "${sentence || word}"

Respond with ONLY a JSON object in this exact format (no markdown, no code blocks):
{
  "translation": "the most natural English translation a fluent speaker would use",
  "literalBreakdown": "word-by-word literal gloss (e.g. 'hand-shoe' for handskoen)",
  "idiomaticMeaning": "if the phrase is an idiom, fixed expression, or compound: what it actually means and why — e.g. 'This is an idiom which literally means X. It is used when ...'",
  "usageNotes": "register, tone, formality, or contextual notes a learner should know (e.g. 'informal', 'used by older speakers', 'often sarcastic', 'common in Bible-influenced Afrikaans')",
  "register": "formal | informal | literary | colloquial | archaic | neutral"
}

CRITICAL — valid JSON only: never put a double-quote character (") inside any string value. To quote a word or phrase, use single quotes ('like this') or parentheses. A raw double quote inside a value breaks the JSON and the lookup fails.

Required fields: translation. All other fields are optional — only include them when they add real value:
- Include literalBreakdown if the phrase is more than one word AND the literal gloss differs from the natural translation in an interesting way.
- Include idiomaticMeaning ALWAYS for idioms, fixed expressions, sayings, proverbs, or compound words whose meaning isn't obvious from the parts. Explain like a teacher would.
- Include usageNotes when the phrase carries register / tone / cultural baggage the learner couldn't infer from the dictionary.
- Include register if you're confident; omit if neutral or unclear.

Be specific and concrete in idiomaticMeaning and usageNotes — avoid vague phrases like 'commonly used' or 'has a special meaning'.`;
}
