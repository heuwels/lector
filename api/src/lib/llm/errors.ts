export class LLMTruncatedError extends Error {
  constructor(
    readonly maxTokens: number,
    readonly canIncreaseBudget: boolean = true,
  ) {
    super(`LLM response reached the ${maxTokens}-token output limit`);
    this.name = 'LLMTruncatedError';
  }
}

export class LLMInvalidJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMInvalidJsonError';
  }
}
