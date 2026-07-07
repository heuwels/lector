import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';

const { default: app } = await import('../routes/settings');

// Settings write validation (#233): writes are checked against the known-key
// allowlist, and URL-shaped keys must parse as http(s) — their values become
// fetch targets that receive stored credentials.

const TEST_KEYS = ['timezone', 'openaiUrl', 'openaiApiKey'];

function clear() {
  db.prepare(`DELETE FROM settings WHERE key IN (${TEST_KEYS.map(() => '?').join(', ')})`).run(...TEST_KEYS);
}

function putBulk(body: unknown) {
  return app.request('/', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function putKey(key: string, value: unknown) {
  return app.request(`/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
}

function storedValue(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE userId = 'local' AND key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

describe('settings write validation (#233)', () => {
  beforeEach(clear);
  afterEach(clear);

  test('known keys write (bulk and per-key)', async () => {
    expect((await putBulk({ timezone: 'Australia/Sydney' })).status).toBe(200);
    expect(storedValue('timezone')).toBe(JSON.stringify('Australia/Sydney'));

    expect((await putKey('timezone', 'Europe/Berlin')).status).toBe(200);
    expect(storedValue('timezone')).toBe(JSON.stringify('Europe/Berlin'));
  });

  test('unknown key → 400 (per-key)', async () => {
    const res = await putKey('totallyMadeUp', 'x');
    expect(res.status).toBe(400);
    expect(storedValue('totallyMadeUp')).toBeUndefined();
  });

  test('unknown key → 400 and nothing from the batch is applied (bulk)', async () => {
    const res = await putBulk({ timezone: 'Australia/Sydney', totallyMadeUp: 'x' });
    expect(res.status).toBe(400);
    // Validate-before-write: the valid key in the same batch must not land.
    expect(storedValue('timezone')).toBeUndefined();
    expect(storedValue('totallyMadeUp')).toBeUndefined();
  });

  test('URL keys reject non-http(s) values', async () => {
    expect((await putKey('openaiUrl', 'not a url')).status).toBe(400);
    expect((await putKey('openaiUrl', 'javascript:alert(1)')).status).toBe(400);
    expect((await putKey('openaiUrl', 'ftp://example.com')).status).toBe(400);
    expect((await putKey('openaiUrl', 42)).status).toBe(400);
    expect(storedValue('openaiUrl')).toBeUndefined();
  });

  test('URL keys accept http(s), and empty string clears the endpoint', async () => {
    expect((await putKey('openaiUrl', 'http://localhost:1234/v1')).status).toBe(200);
    expect(storedValue('openaiUrl')).toBe(JSON.stringify('http://localhost:1234/v1'));

    expect((await putKey('openaiUrl', 'https://api.example.com/v1')).status).toBe(200);
    expect((await putKey('openaiUrl', '')).status).toBe(200);
    expect(storedValue('openaiUrl')).toBe(JSON.stringify(''));
  });

  test('sensitive keys stay writable and are masked on read', async () => {
    expect((await putKey('openaiApiKey', 'sk-test-not-real')).status).toBe(200);

    const single = await app.request('/openaiApiKey');
    expect(await single.json()).toBe(true);

    const bulk = await app.request('/');
    const all = (await bulk.json()) as Record<string, unknown>;
    expect(all.openaiApiKey).toBe(true);
  });
});
