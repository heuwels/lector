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
 * {...} or [...] span.
 */
export function parseLooseJson<T = unknown>(text: string): T {
  // 1. Drop reasoning <think>…</think> blocks first — their braces would
  //    otherwise derail the span extraction in step 3.
  const thinkless = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Strip a surrounding ```json … ``` (or bare ``` … ```) fence.
  const fence = thinkless.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  const unfenced = (fence ? fence[1] : thinkless).trim();

  // 3. Try parsing the cleaned text as-is.
  try {
    return JSON.parse(unfenced) as T;
  } catch {
    // 4. Fall back to the outermost object/array span, dropping any prose the
    //    model added on either side.
    const first = unfenced.search(/[[{]/);
    const last = Math.max(unfenced.lastIndexOf('}'), unfenced.lastIndexOf(']'));
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(unfenced.slice(first, last + 1)) as T;
      } catch {
        // fall through to the shared error below
      }
    }
    const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
    throw new Error(`Model did not return valid JSON. Got: ${JSON.stringify(preview)}`);
  }
}
