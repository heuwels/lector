import { jsonrepair } from 'jsonrepair';

/**
 * Parse JSON returned by an LLM.
 *
 * We can't rely on server-side JSON mode: no `response_format` value works
 * across every OpenAI-compatible backend (LM Studio 400s on `json_object` and
 * wants `json_schema`; Ollama silently ignores `json_schema` and only does
 * structured output via its native `format` field). So every JSON caller asks
 * for JSON in the prompt instead — and real models add wrappers around it:
 *   - reasoning models (DeepSeek-R1 distills, Qwen3, common in LM Studio) emit a
 *     <think>…</think> block first, usually containing braces;
 *   - chat-tuned models wrap output in a ```json fence or a sentence of preamble.
 * This strips those before parsing, then falls back to extracting the outermost
 * {...} or [...] span, and finally to jsonrepair() for structural noise that
 * strict JSON.parse rejects (trailing commas, unquoted keys, single quotes, an
 * unterminated tail from a truncated response).
 *
 * IMPORTANT — jsonrepair only ever *closes structure or normalises delimiters*;
 * it never drops bytes the model actually sent. The one failure it can't repair
 * is an unescaped double-quote inside a string value (e.g. the model writes
 *   "etymology": "From Dutch lekker ("tasty"), ..."
 * — common when a model quotes a gloss). That is genuinely ambiguous, so
 * jsonrepair throws and so do we. Throwing is deliberate: these results get
 * persisted into the on-device dictionary, and a hard error (the caller retries)
 * is strictly safer than silently saving a string truncated at the stray quote.
 * The prompts ask models to use single quotes inside values to avoid this.
 */
export interface LooseJsonResult<T> {
  value: T;
  repaired: boolean;
  rootComplete: boolean;
}

function hasCompleteJsonRoot(text: string): boolean {
  const first = text.search(/[[{]/);
  if (first === -1) return false;

  const stack: string[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = first; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return false;
      if (stack.length === 0) return true;
    }
  }
  return false;
}

/** Parse JSON while also reporting whether its outer container was complete. */
export function parseLooseJsonResult<T = unknown>(text: string): LooseJsonResult<T> {
  // 1. Drop reasoning <think>…</think> blocks first — their braces would
  //    otherwise derail the span extraction in step 3.
  const thinkless = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Strip a surrounding ```json … ``` (or bare ``` … ```) fence.
  const fence = thinkless.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  const unfenced = (fence ? fence[1] : thinkless).trim();

  // 3. Try parsing the cleaned text as-is.
  try {
    return { value: JSON.parse(unfenced) as T, repaired: false, rootComplete: true };
  } catch {
    // 4. Fall back to the outermost object/array span, dropping any prose the
    //    model added on either side.
    const first = unfenced.search(/[[{]/);
    const last = Math.max(unfenced.lastIndexOf('}'), unfenced.lastIndexOf(']'));
    if (first !== -1 && last > first) {
      const span = unfenced.slice(first, last + 1);
      try {
        return {
          value: JSON.parse(span) as T,
          repaired: false,
          // Parsing the outer span strictly proves its root is balanced.
          rootComplete: true,
        };
      } catch {
        // 5. Last resort: repair structural noise (trailing commas, unquoted
        //    keys, single quotes) and re-parse. Two candidates, in order:
        //      a) first bracket → END of the text, so a response truncated
        //         mid-value keeps every byte the model actually sent (e.g. an
        //         ipa/etymology that sit after the last *complete* bracket and
        //         would otherwise be silently dropped by the span slice below);
        //      b) the bracket-trimmed span, which strips trailing prose that (a)
        //         chokes on (jsonrepair won't discard junk after the JSON).
        //    We repair ONLY a real {...}/[...] span — never bare prose, which
        //    jsonrepair would wrap into a JSON string and smuggle a refusal past
        //    the caller — and require an object/array result for the same
        //    reason. (A brace-shaped refusal like { reason: '…' } can still pass
        //    this guard; that's accepted — the caller reads word/senses off the
        //    result, so a refusal object surfaces as an empty entry, and the
        //    dictionary cache rejects sense-less entries, so nothing junk gets
        //    persisted.) jsonrepair throws on irrecoverable input (e.g. unescaped
        //    inner quotes); we let that fall through to the shared error below.
        const tailKept = unfenced.slice(first);
        for (const candidate of tailKept === span ? [span] : [tailKept, span]) {
          try {
            const repaired = JSON.parse(jsonrepair(candidate));
            if (repaired !== null && typeof repaired === 'object') {
              return {
                value: repaired as T,
                repaired: true,
                rootComplete: hasCompleteJsonRoot(candidate),
              };
            }
          } catch {
            // try the next candidate / fall through to the shared error below
          }
        }
      }
    }
    const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
    throw new Error(`Model did not return valid JSON. Got: ${JSON.stringify(preview)}`);
  }
}

export function parseLooseJson<T = unknown>(text: string): T {
  return parseLooseJsonResult<T>(text).value;
}
