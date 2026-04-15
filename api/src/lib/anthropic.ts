import Anthropic from '@anthropic-ai/sdk';

const oauthToken =
  process.env.CLAUDE_OAUTH_TOKEN ||
  process.env.CLAUDE_CODE_OAUTH_TOKEN ||
  process.env.ANTHROPIC_AUTH_TOKEN;

const apiKey = process.env.ANTHROPIC_API_KEY;

if (oauthToken) {
  console.log('Anthropic client: using OAuth token (plan credits)');
} else if (apiKey) {
  console.log('Anthropic client: using API key');
} else {
  console.warn(
    'Anthropic client: no credentials found — Claude features will fail'
  );
}

export const client = oauthToken
  ? new Anthropic({ authToken: oauthToken, apiKey: undefined as unknown as string })
  : new Anthropic();
