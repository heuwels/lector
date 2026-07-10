import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { db } from '../db';

export const BYOK_PROVIDER = 'openrouter' as const;
export const OPENROUTER_URL = 'https://openrouter.ai/api';
export const DEFAULT_BYOK_MODEL = 'google/gemini-2.5-flash-lite';

export const BYOK_MODELS = [
  { id: DEFAULT_BYOK_MODEL, label: 'Gemini 2.5 Flash Lite' },
  { id: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3' },
  { id: 'anthropic/claude-3.5-haiku', label: 'Claude Haiku' },
  { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet' },
] as const;

interface CredentialRow {
  provider: typeof BYOK_PROVIDER;
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
  const row = db
    .prepare(
      'SELECT provider, ciphertext, model, updatedAt FROM user_provider_credentials WHERE userId = ? AND provider = ?',
    )
    .get(userId, BYOK_PROVIDER) as CredentialRow | undefined;
  if (!row) return null;
  return { ...row, apiKey: decryptCredential(userId, row.provider, row.ciphertext) };
}

export function hasByokCredential(userId: string): boolean {
  if (!isByokAvailable()) return false;
  const row = db
    .prepare('SELECT 1 FROM user_provider_credentials WHERE userId = ? AND provider = ?')
    .get(userId, BYOK_PROVIDER);
  return Boolean(row);
}

export function saveByokCredential(userId: string, apiKey: string, model: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO user_provider_credentials (userId, provider, ciphertext, model, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(userId, provider) DO UPDATE SET
      ciphertext = excluded.ciphertext, model = excluded.model, updatedAt = excluded.updatedAt
  `,
  ).run(userId, BYOK_PROVIDER, encryptCredential(userId, BYOK_PROVIDER, apiKey), model, now, now);
}

export function deleteByokCredential(userId: string): void {
  db.prepare('DELETE FROM user_provider_credentials WHERE userId = ? AND provider = ?').run(
    userId,
    BYOK_PROVIDER,
  );
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
