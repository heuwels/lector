import Anthropic from '@anthropic-ai/sdk';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import os from 'os';
import path from 'path';
import fs from 'fs';

const oauthToken =
  process.env.CLAUDE_OAUTH_TOKEN ||
  process.env.CLAUDE_CODE_OAUTH_TOKEN ||
  process.env.ANTHROPIC_AUTH_TOKEN;

const apiKey = process.env.ANTHROPIC_API_KEY;

const useAgentSdk = !!oauthToken && !apiKey;

if (useAgentSdk) {
  console.log('Anthropic: using Agent SDK with OAuth token (plan credits)');
} else if (apiKey) {
  console.log('Anthropic: using SDK with API key');
} else {
  console.warn('Anthropic: no credentials found — Claude features will fail');
}

// Direct SDK client — only works with API key
export const client = apiKey ? new Anthropic() : null;

/**
 * Send a prompt to Claude and get the text response.
 * Uses Agent SDK (OAuth) when available, falls back to direct API.
 */
export async function prompt(text: string, maxTokens: number = 2048, model?: string): Promise<string> {
  if (useAgentSdk) {
    return promptViaAgentSdk(text, model);
  }
  if (!client) {
    throw new Error('No Anthropic credentials configured');
  }
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: text }],
  });
  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }
  return content.text;
}

/**
 * Use the Claude Agent SDK query() to send a prompt via OAuth.
 * Collects assistant text from the message stream.
 */
async function promptViaAgentSdk(text: string, model?: string): Promise<string> {
  // Agent SDK needs a writable cwd — use a temp dir
  const tmpDir = path.join(os.tmpdir(), 'lector-agent-sdk');
  fs.mkdirSync(tmpDir, { recursive: true });

  const systemPrompt = 'You are a helpful assistant. Respond with ONLY the requested content, no preamble or explanation beyond what is asked.';

  let result = '';
  for await (const message of agentQuery({
    prompt: text,
    options: {
      cwd: tmpDir,
      tools: [],
      systemPrompt,
      maxTurns: 1,
      ...(model ? { model } : {}),
    },
  })) {
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if (typeof block === 'object' && 'text' in block) {
          result += block.text;
        }
      }
    }
  }

  if (!result) {
    throw new Error('No response from Claude');
  }
  return result;
}
