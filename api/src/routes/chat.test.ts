import '../test-guard';
import { describe, test, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { db } from '../db';
import * as actualLlm from '../lib/llm';
import {
  makeEntitlements,
  parsePlanLimitOverrides,
  setEntitlementsEngineForTests,
} from '../lib/entitlements';

// Mock the provider factory so POST never reaches a real LLM. Each test swaps
// `currentProvider` and inspects `captured` to assert what the route sent.
//
// bun module mocks are process-global and outlive this file, so the factory
// must spread the real module — a bare `{ getProvider }` erased every other
// export (`completeJson`, `MANAGED_TRANSLATION_MODEL`, …) for any test file
// that happened to load after this one, which is CI-order-dependent. The
// afterAll re-mock hands later files the real getProvider back too.
let currentProvider: unknown = null;
const captured: { messages?: { role: string; content: string }[] } = {};

mock.module('../lib/llm', () => ({
  ...actualLlm,
  getProvider: () => currentProvider,
}));
afterAll(() => {
  mock.module('../lib/llm', () => ({ ...actualLlm }));
});

const { default: app, MAX_CHAT_MESSAGE_BYTES } = await import('../routes/chat');

let restoreEngine: (() => void) | null = null;

function useFreeByokEntitlements() {
  const planLimits = parsePlanLimitOverrides(undefined);
  restoreEngine?.();
  restoreEngine = setEntitlementsEngineForTests(
    makeEntitlements({
      enforced: true,
      freeTierEnabled: true,
      exemptEmails: new Set(),
      prices: [],
      planLimits,
      resolveEmail: () => null,
      isByok: () => true,
      compedPlan: () => null,
      now: () => new Date('2026-07-15T12:00:00Z'),
    }),
  );
}

// Timestamps must be recent: the route's cleanExpired() purges rows older than
// the 7-day TTL on every GET/POST. Relative-to-now keeps seeds valid over time.
const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function seed(opts: {
  id: string;
  language: string;
  minutesAgo: number;
  role?: 'user' | 'assistant';
  content?: string;
  responseId?: string | null;
}) {
  db.prepare(
    'INSERT INTO chat_messages (id, role, content, provider, responseId, createdAt, language) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    opts.id,
    opts.role ?? 'user',
    opts.content ?? 'msg',
    null,
    opts.responseId ?? null,
    ago(opts.minutesAgo),
    opts.language,
  );
}

function setActiveLanguage(code: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'targetLanguage',
    JSON.stringify(code),
  );
}

function reset() {
  restoreEngine?.();
  restoreEngine = null;
  db.prepare('DELETE FROM chat_messages').run();
  db.prepare("DELETE FROM settings WHERE key = 'targetLanguage'").run();
  captured.messages = undefined;
}

describe('chat route — per-language scoping', () => {
  beforeEach(() => {
    reset();
    // Default: a generic stateless provider (NOT LM Studio → else branch).
    currentProvider = {
      name: 'mock-provider',
      complete: async (opts: { messages: { role: string; content: string }[] }) => {
        captured.messages = opts.messages;
        return 'MOCK ANSWER';
      },
    };
  });

  afterEach(reset);

  // ---- GET ----
  test('GET filters history by the lang query param', async () => {
    seed({ id: 'af1', language: 'af', minutesAgo: 1 });
    seed({ id: 'es1', language: 'es', minutesAgo: 1 });

    const res = await app.request('/?language=es');
    expect(res.status).toBe(200);
    const msgs = (await res.json()) as { id: string }[];
    expect(msgs.map((m) => m.id)).toEqual(['es1']);
  });

  test('GET falls back to the active-language setting when lang is absent', async () => {
    setActiveLanguage('de');
    seed({ id: 'de1', language: 'de', minutesAgo: 1 });
    seed({ id: 'af1', language: 'af', minutesAgo: 1 });

    const res = await app.request('/');
    const msgs = (await res.json()) as { id: string }[];
    expect(msgs.map((m) => m.id)).toEqual(['de1']);
  });

  test('GET with a before cursor stays within the language', async () => {
    seed({ id: 'es_old', language: 'es', minutesAgo: 2 });
    seed({ id: 'es_new', language: 'es', minutesAgo: 1 });
    seed({ id: 'af_old', language: 'af', minutesAgo: 2 });

    const res = await app.request(`/?language=es&before=${encodeURIComponent(ago(1.5))}`);
    const msgs = (await res.json()) as { id: string }[];
    expect(msgs.map((m) => m.id)).toEqual(['es_old']);
  });

  test('GET returns oldest-first (reversed) within a language', async () => {
    seed({ id: 'es_old', language: 'es', minutesAgo: 2 });
    seed({ id: 'es_new', language: 'es', minutesAgo: 1 });

    const res = await app.request('/?language=es');
    const msgs = (await res.json()) as { id: string }[];
    expect(msgs.map((m) => m.id)).toEqual(['es_old', 'es_new']);
  });

  // ---- DELETE ----
  test('DELETE clears only the requested language', async () => {
    seed({ id: 'af1', language: 'af', minutesAgo: 1 });
    seed({ id: 'es1', language: 'es', minutesAgo: 1 });

    const res = await app.request('/?language=af', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const remaining = db.prepare('SELECT id FROM chat_messages').all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual(['es1']);
  });

  test('DELETE falls back to the active language when lang is absent', async () => {
    setActiveLanguage('es');
    seed({ id: 'af1', language: 'af', minutesAgo: 1 });
    seed({ id: 'es1', language: 'es', minutesAgo: 1 });

    await app.request('/', { method: 'DELETE' });
    const remaining = db.prepare('SELECT id FROM chat_messages').all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual(['af1']);
  });

  // ---- POST (generic stateless provider) ----
  test('POST tags both stored messages with the resolved language', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hallo', language: 'de' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assistantMessage: { content: string } };
    expect(body.assistantMessage.content).toBe('MOCK ANSWER');

    const rows = db.prepare('SELECT role, language FROM chat_messages').all() as {
      role: string;
      language: string;
    }[];
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.language === 'de')).toBe(true);
  });

  test('POST only sends same-language history to the provider', async () => {
    // A prior conversation in af must not leak into a de turn.
    seed({ id: 'af_user', role: 'user', language: 'af', content: 'AF CONTEXT', minutesAgo: 2 });
    seed({ id: 'af_asst', role: 'assistant', language: 'af', content: 'AF REPLY', minutesAgo: 1 });

    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'neue frage', language: 'de' }),
    });

    const sent = captured.messages ?? [];
    const joined = sent.map((m) => m.content).join('\n');
    expect(joined).toContain('neue frage');
    expect(joined).not.toContain('AF CONTEXT');
    expect(joined).not.toContain('AF REPLY');
  });

  test('POST falls back to the active language when language is omitted', async () => {
    setActiveLanguage('es');
    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hola' }),
    });
    const rows = db.prepare('SELECT language FROM chat_messages').all() as { language: string }[];
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.language === 'es')).toBe(true);
  });

  test('POST rejects an empty message with 400', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  test('Free BYOK chat returns the provider response without storing history', async () => {
    useFreeByokEntitlements();

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'help me', language: 'de' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ assistantMessage: { content: 'MOCK ANSWER' } });
    expect(captured.messages?.at(-1)?.content).toContain('help me');
    expect((db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get() as { n: number }).n).toBe(
      0,
    );
  });

  test('POST enforces a universal 32 KiB UTF-8 message limit before provider use', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'é'.repeat(MAX_CHAT_MESSAGE_BYTES / 2 + 1) }),
    });

    expect(res.status).toBe(413);
    expect(captured.messages).toBeUndefined();
    expect((db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get() as { n: number }).n).toBe(
      0,
    );
  });
});
