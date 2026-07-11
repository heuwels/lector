import { LLMInvalidJsonError, LLMTruncatedError } from './errors';
import { parseLooseJsonResult } from './parse-json';
import type { CompletionOptions, CompletionResponseFormat, LLMProvider } from './types';

type JsonResponseFormat = Extract<CompletionResponseFormat, 'json-object' | 'json-array'>;

export type JsonCompletionOptions = Omit<CompletionOptions, 'responseFormat'> & {
  responseFormat?: JsonResponseFormat;
};

type ParseResult<T> = { value: T; error?: never } | { value?: never; error: Error };

const JSON_RETRY_INSTRUCTION =
  'Your previous response could not be parsed as valid JSON. Return the complete answer again as exactly one valid JSON value with no markdown, code fences, commentary, or trailing text.';

function preview(text: string): string {
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function parseExpectedRoot<T>(text: string, format: JsonResponseFormat): ParseResult<T> {
  let parsed: unknown;
  try {
    const result = parseLooseJsonResult<unknown>(text);
    parsed = result.value;
    if (!result.rootComplete) {
      return {
        error: new LLMInvalidJsonError(
          `Model returned incomplete JSON. Got: ${JSON.stringify(preview(text))}`,
        ),
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: new LLMInvalidJsonError(message) };
  }

  const validRoot =
    format === 'json-array'
      ? Array.isArray(parsed)
      : parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  if (!validRoot) {
    const expected = format === 'json-array' ? 'array' : 'object';
    return {
      error: new LLMInvalidJsonError(
        `Model did not return a JSON ${expected}. Got: ${JSON.stringify(preview(text))}`,
      ),
    };
  }

  return { value: parsed as T };
}

function addRetryInstruction(options: CompletionOptions): CompletionOptions['messages'] {
  const messages = options.messages.map((message) => ({ ...message }));
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      messages[index].content = `${messages[index].content}\n\n${JSON_RETRY_INSTRUCTION}`;
      return messages;
    }
  }
  messages.push({ role: 'user', content: JSON_RETRY_INSTRUCTION });
  return messages;
}

async function attempt<T>(
  provider: LLMProvider,
  options: CompletionOptions,
  format: JsonResponseFormat,
): Promise<ParseResult<T>> {
  const text = await provider.complete(options);
  return parseExpectedRoot<T>(text, format);
}

/**
 * Complete and parse one JSON operation with at most one provider retry.
 * Truncation gets a larger output budget; malformed complete output gets a
 * corrective prompt at the original budget. Provider/network failures are not
 * retried here.
 */
export async function completeJson<T>(
  provider: LLMProvider,
  options: JsonCompletionOptions,
): Promise<T> {
  const format = options.responseFormat ?? 'json-object';
  const firstOptions: CompletionOptions = { ...options, responseFormat: format };

  let retryTokens = options.maxTokens;
  let retryMessages = options.messages;
  try {
    const first = await attempt<T>(provider, firstOptions, format);
    if (first.value !== undefined) return first.value;
    retryMessages = addRetryInstruction(firstOptions);
  } catch (error) {
    if (!(error instanceof LLMTruncatedError)) throw error;
    retryTokens = error.canIncreaseBudget ? options.maxTokens * 2 : options.maxTokens;
  }

  const retryOptions: CompletionOptions = {
    ...firstOptions,
    messages: retryMessages,
    maxTokens: retryTokens,
  };
  try {
    const retry = await attempt<T>(provider, retryOptions, format);
    if (retry.value !== undefined) return retry.value;
    throw retry.error;
  } catch (error) {
    if (error instanceof LLMTruncatedError) {
      const budget = retryTokens > options.maxTokens ? ` with a ${retryTokens}-token limit` : '';
      throw new Error(`LLM response was truncated after retrying${budget}`);
    }
    throw error;
  }
}
