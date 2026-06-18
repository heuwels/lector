import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrateLlmProviderSettings } from './db';

// Build a throwaway in-memory DB with just the settings table, seeded with the
// JSON-stringified values the app stores (getSetting JSON.parses them back).
function freshDb(seed: Record<string, unknown> = {}): Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(seed)) stmt.run(k, JSON.stringify(v));
  return db;
}

function getVal(db: Database, key: string): unknown {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

describe('migrateLlmProviderSettings', () => {
  test('lmstudio → copies url/model and the RAW api key, preset lmstudio, provider openai', () => {
    const db = freshDb({
      llmProvider: 'lmstudio',
      lmstudioUrl: 'http://host:1234',
      lmstudioModel: 'qwen/qwen2.5',
      lmstudioApiKey: 'sk-secret',
    });
    migrateLlmProviderSettings(db);

    expect(getVal(db, 'llmProvider')).toBe('openai');
    expect(getVal(db, 'openaiUrl')).toBe('http://host:1234');
    expect(getVal(db, 'openaiModel')).toBe('qwen/qwen2.5');
    // The migration reads the key straight from the DB (not the masked API), so
    // it copies the real secret — not the `true` the settings endpoint returns.
    expect(getVal(db, 'openaiApiKey')).toBe('sk-secret');
    expect(getVal(db, 'openaiPreset')).toBe('lmstudio');
  });

  test('ollama → applies the default model and does NOT write openaiUrl (env fallback)', () => {
    const db = freshDb({ llmProvider: 'ollama' }); // no ollamaModel set
    migrateLlmProviderSettings(db);

    expect(getVal(db, 'llmProvider')).toBe('openai');
    expect(getVal(db, 'openaiModel')).toBe('llama3.1:8b');
    // Deliberately unset: ollama had no URL setting, so we leave the OLLAMA_URL
    // env fallback to resolve it (writing a default would break docker's
    // http://ollama:11434). This assertion locks that choice in.
    expect(getVal(db, 'openaiUrl')).toBeNull();
    expect(getVal(db, 'openaiPreset')).toBe('ollama');
  });

  test('ollama → preserves an explicitly-set model', () => {
    const db = freshDb({ llmProvider: 'ollama', ollamaModel: 'gemma2:9b' });
    migrateLlmProviderSettings(db);
    expect(getVal(db, 'openaiModel')).toBe('gemma2:9b');
  });

  test('apfel → copies url/model, preset custom', () => {
    const db = freshDb({ llmProvider: 'apfel', apfelUrl: 'http://apfel:11434', apfelModel: 'default' });
    migrateLlmProviderSettings(db);

    expect(getVal(db, 'llmProvider')).toBe('openai');
    expect(getVal(db, 'openaiUrl')).toBe('http://apfel:11434');
    expect(getVal(db, 'openaiModel')).toBe('default');
    expect(getVal(db, 'openaiPreset')).toBe('custom');
  });

  test('idempotent — a second run is a no-op (does not clobber edited values)', () => {
    const db = freshDb({ llmProvider: 'lmstudio', lmstudioUrl: 'http://host:1234', lmstudioModel: 'm' });
    migrateLlmProviderSettings(db);

    // Simulate the user later changing the endpoint, then re-running init.
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'openaiUrl',
      JSON.stringify('http://changed:1234'),
    );
    migrateLlmProviderSettings(db);

    // provider is now 'openai' → the guard short-circuits → value untouched.
    expect(getVal(db, 'openaiUrl')).toBe('http://changed:1234');
  });

  test('anthropic → left completely untouched', () => {
    const db = freshDb({ llmProvider: 'anthropic', anthropicApiKey: 'sk-ant' });
    migrateLlmProviderSettings(db);

    expect(getVal(db, 'llmProvider')).toBe('anthropic');
    expect(getVal(db, 'openaiUrl')).toBeNull();
    expect(getVal(db, 'openaiModel')).toBeNull();
    expect(getVal(db, 'openaiPreset')).toBeNull();
  });

  test('unset provider (fresh install) → left untouched', () => {
    const db = freshDb({});
    migrateLlmProviderSettings(db);

    expect(getVal(db, 'llmProvider')).toBeNull();
    expect(getVal(db, 'openaiModel')).toBeNull();
    expect(getVal(db, 'openaiPreset')).toBeNull();
  });
});
