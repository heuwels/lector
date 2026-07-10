import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';

export const BYOK_PROVIDERS = ['openrouter', 'anthropic'] as const;
export type ByokProvider = (typeof BYOK_PROVIDERS)[number];
export const DEFAULT_BYOK_PROVIDER: ByokProvider = 'openrouter';
export const OPENROUTER_URL = 'https://openrouter.ai/api';
export const BYOK_CATALOG = {
  openrouter: {
    label: 'OpenRouter',
    keyPlaceholder: 'sk-or-v1-…',
    defaultModel: 'google/gemini-2.5-flash-lite',
    models: [
      { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite — low-cost default' },
      { id: 'openai/gpt-5', label: 'GPT-5 — eval 95.3' },
      { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro — eval 95.3' },
      { id: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8 — eval 95.1' },
      { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6 — eval 95.1' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini — eval 95.0' },
      { id: 'openai/gpt-4o', label: 'GPT-4o — eval 94.9' },
      { id: 'mistralai/mistral-large', label: 'Mistral Large — eval 94.8' },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B — eval 94.7' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash — eval 94.7' },
      { id: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2 — eval 94.7' },
      { id: 'google/gemma-2-27b-it', label: 'Gemma 2 27B — eval 94.5' },
      { id: 'google/gemma-3-27b-it', label: 'Gemma 3 27B — eval 94.4' },
      { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5 — eval 94.3' },
      {
        id: 'mistralai/mistral-small-3.2-24b-instruct',
        label: 'Mistral Small 3.2 24B — eval 94.0',
      },
    ],
  },
  anthropic: {
    label: 'Anthropic',
    keyPlaceholder: 'sk-ant-api03-…',
    defaultModel: 'claude-haiku-4-5',
    models: [
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    ],
  },
} satisfies Record<
  ByokProvider,
  {
    label: string;
    keyPlaceholder: string;
    defaultModel: string;
    models: Array<{ id: string; label: string }>;
  }
>;

interface CredentialRow {
  provider: ByokProvider;
  ciphertext: string;
  model: string;
  updatedAt: string;
}

function encryptionKey(): Buffer | null {
  const raw = process.env.BYOK_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function isByokAvailable(): boolean {
  return encryptionKey() !== null;
}

function aad(userId: string, provider: string): Buffer {
  return Buffer.from(`lector-byok:v1:${userId}:${provider}`, 'utf8');
}

export function encryptCredential(userId: string, provider: string, secret: string): string {
  const key = encryptionKey();
  if (!key) throw new Error('BYOK encryption is not configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(userId, provider));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptCredential(userId: string, provider: string, value: string): string {
  const key = encryptionKey();
  if (!key) throw new Error('BYOK encryption is not configured');
  const [version, iv, tag, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Invalid BYOK credential');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(aad(userId, provider));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function getByokCredential(userId: string): (CredentialRow & { apiKey: string }) | null {
  if (!isByokAvailable()) return null;
  const row = db
    .prepare(
      'SELECT provider, ciphertext, model, updatedAt FROM user_provider_credentials WHERE userId = ? ORDER BY updatedAt DESC LIMIT 1',
    )
    .get(userId) as CredentialRow | undefined;
  if (!row) return null;
  try {
    return { ...row, apiKey: decryptCredential(userId, row.provider, row.ciphertext) };
  } catch {
    // A missing/rotated master key degrades to managed AI. Never leave the
    // account entitled as BYOK while every LLM request fails to decrypt.
    return null;
  }
}

export function hasByokCredential(userId: string): boolean {
  return getByokCredential(userId) !== null;
}

export function saveByokCredential(
  userId: string,
  provider: ByokProvider,
  apiKey: string,
  model: string,
): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    // Exactly one active provider per account keeps routing deterministic.
    db.prepare('DELETE FROM user_provider_credentials WHERE userId = ?').run(userId);
    db.prepare(
      `INSERT INTO user_provider_credentials
        (userId, provider, ciphertext, model, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(userId, provider, encryptCredential(userId, provider, apiKey), model, now, now);
  })();
}

export function deleteByokCredential(userId: string): void {
  db.prepare('DELETE FROM user_provider_credentials WHERE userId = ?').run(userId);
}

/** Validate through the official Anthropic SDK's authenticated Models API. */
export async function validateAnthropicKey(apiKey: string): Promise<boolean> {
  try {
    await new Anthropic({ apiKey, timeout: 15_000 }).models.list({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}

/** Validate against OpenRouter's authenticated key-introspection endpoint.
 * `/models` is public and therefore cannot prove a submitted key is valid. */
export async function validateOpenRouterKey(apiKey: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${OPENROUTER_URL}/v1/key`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
