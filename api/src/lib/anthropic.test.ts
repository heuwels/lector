import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

const ENV_KEYS = [
  'CLAUDE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
];

function clearEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

// We need to re-import the module each time to test different env states.
// Bun doesn't have jest.resetModules(), so we use dynamic import with cache busting.
let importCounter = 0;
async function importFresh() {
  // Write a temp re-export so each import is a new module evaluation
  const mod = await import(`../lib/anthropic?v=${++importCounter}`);
  return mod.client;
}

describe('Anthropic client factory', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    clearEnv();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test('uses CLAUDE_OAUTH_TOKEN when set', async () => {
    process.env.CLAUDE_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    const client = await importFresh();
    expect(client).toBeDefined();
    expect(client.authToken).toBe('sk-ant-oat01-test-token');
  });

  test('uses CLAUDE_CODE_OAUTH_TOKEN as fallback', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-code-token';
    const client = await importFresh();
    expect(client).toBeDefined();
    expect(client.authToken).toBe('sk-ant-oat01-code-token');
  });

  test('CLAUDE_OAUTH_TOKEN takes precedence over CLAUDE_CODE_OAUTH_TOKEN', async () => {
    process.env.CLAUDE_OAUTH_TOKEN = 'sk-ant-oat01-primary';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-secondary';
    const client = await importFresh();
    expect(client.authToken).toBe('sk-ant-oat01-primary');
  });

  test('falls back to ANTHROPIC_API_KEY when no OAuth token', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api-test-key';
    const client = await importFresh();
    expect(client).toBeDefined();
    expect(client.apiKey).toBe('sk-ant-api-test-key');
    expect(client.authToken).toBeNull();
  });
});
