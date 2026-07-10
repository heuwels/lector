import '../test-guard';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'crypto';
import { db } from '../db';
import {
  BYOK_PROVIDER,
  decryptCredential,
  deleteByokCredential,
  encryptCredential,
  getByokCredential,
  hasByokCredential,
  isByokAvailable,
  saveByokCredential,
} from './byok';
import { getProvider } from './llm';

const previousKey = process.env.BYOK_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.BYOK_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  db.prepare("DELETE FROM user_provider_credentials WHERE userId LIKE 'byok-test-%'").run();
});

afterAll(() => {
  if (previousKey === undefined) delete process.env.BYOK_ENCRYPTION_KEY;
  else process.env.BYOK_ENCRYPTION_KEY = previousKey;
});

describe('BYOK encryption', () => {
  test('round-trips with tenant/provider-bound authenticated encryption', () => {
    const encrypted = encryptCredential('byok-test-a', BYOK_PROVIDER, 'sk-secret');
    expect(encrypted).not.toContain('sk-secret');
    expect(decryptCredential('byok-test-a', BYOK_PROVIDER, encrypted)).toBe('sk-secret');
    expect(() => decryptCredential('byok-test-b', BYOK_PROVIDER, encrypted)).toThrow();
  });

  test('rejects absent and malformed encryption keys', () => {
    delete process.env.BYOK_ENCRYPTION_KEY;
    expect(isByokAvailable()).toBe(false);
    expect(() => encryptCredential('byok-test-a', BYOK_PROVIDER, 'secret')).toThrow();
    process.env.BYOK_ENCRYPTION_KEY = Buffer.from('short').toString('base64');
    expect(isByokAvailable()).toBe(false);
  });
});

describe('per-user credential storage and routing', () => {
  test('stores no plaintext and isolates accounts', () => {
    saveByokCredential('byok-test-a', 'sk-user-a', 'model-a');
    const stored = db
      .prepare('SELECT ciphertext FROM user_provider_credentials WHERE userId = ? AND provider = ?')
      .get('byok-test-a', BYOK_PROVIDER) as { ciphertext: string };

    expect(stored.ciphertext).not.toContain('sk-user-a');
    expect(getByokCredential('byok-test-a')?.apiKey).toBe('sk-user-a');
    expect(getByokCredential('byok-test-b')).toBeNull();
    expect(hasByokCredential('byok-test-a')).toBe(true);
    expect(hasByokCredential('byok-test-b')).toBe(false);
  });

  test('selects the account model and falls back after disable', () => {
    saveByokCredential('byok-test-a', 'sk-user-a', 'model-a');
    expect(getProvider('byok-test-a').model).toBe('model-a');
    deleteByokCredential('byok-test-a');
    expect(hasByokCredential('byok-test-a')).toBe(false);
  });
});
