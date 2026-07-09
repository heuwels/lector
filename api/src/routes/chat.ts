import { Hono } from 'hono';
import { db, ChatMessageRow } from '../db';
import { getProvider } from '../lib/llm';
import { getCurrentUserId } from '../lib/user';
import { resolveLanguage } from '../lib/active-language';
import { getLanguageConfig } from '../lib/languages';
import { entitlements, planLimitResponse } from '../lib/entitlements';
import { randomUUID } from 'crypto';

const app = new Hono();

// TODO: add per-language system prompt configuration in Settings
function getSystemPrompt(langName: string): string {
  return `You are a friendly ${langName} language tutor helping an English speaker learn ${langName}. Answer questions about grammar, vocabulary, usage, idioms, and differences between similar words or phrases. Keep answers concise and educational. Use examples where helpful. Reply in English unless the student writes in ${langName}, in which case reply in ${langName} with an English explanation.`;
}

const MAX_CONTEXT_MESSAGES = 20;
const TTL_DAYS = 7;

function cleanExpired() {
  db.prepare(
    `DELETE FROM chat_messages WHERE createdAt < datetime('now', '-${TTL_DAYS} days')`
  ).run();
}

// GET /api/chat — fetch message history
app.get('/', (c) => {
  cleanExpired();

  const userId = getCurrentUserId(c);
  const limit = parseInt(c.req.query('limit') || '50');
  const before = c.req.query('before'); // cursor for infinite scroll
  const lang = resolveLanguage(c.req.query('language'), userId);

  let messages: ChatMessageRow[];

  if (before) {
    messages = db
      .prepare('SELECT * FROM chat_messages WHERE userId = ? AND createdAt < ? AND language = ? ORDER BY createdAt DESC LIMIT ?')
      .all(userId, before, lang, limit) as ChatMessageRow[];
  } else {
    messages = db
      .prepare('SELECT * FROM chat_messages WHERE userId = ? AND language = ? ORDER BY createdAt DESC LIMIT ?')
      .all(userId, lang, limit) as ChatMessageRow[];
  }

  return c.json(messages.reverse());
});

// POST /api/chat — send a message, get assistant response
app.post('/', async (c) => {
  try {
    cleanExpired();

    const userId = getCurrentUserId(c);
    const { message, language } = await c.req.json();

    if (!message?.trim()) {
      return c.json({ error: 'message is required' }, 400);
    }

    const llmVerdict = entitlements.checkLimit(userId, 'llmRequestsPerMonth');
    if (!llmVerdict.allowed) return planLimitResponse(c, llmVerdict);

    const lang = resolveLanguage(language, userId);
    const langName = getLanguageConfig(lang).name;
    const SYSTEM_PROMPT = getSystemPrompt(langName);

    const now = new Date().toISOString();
    const userMsg: ChatMessageRow = {
      id: randomUUID(),
      role: 'user',
      content: message.trim(),
      provider: null,
      responseId: null,
      createdAt: now,
      language: lang
    };

    const provider = getProvider();

    // Send the full recent (same-language) history every turn. We previously had
    // a stateful path for LM Studio that threaded a server-side response_id; that
    // was dropped when the local providers were unified behind one
    // OpenAI-compatible backend, so every provider now uses this single path.
    const recentMessages = db
      .prepare('SELECT * FROM chat_messages WHERE userId = ? AND language = ? ORDER BY createdAt DESC LIMIT ?')
      .all(userId, lang, MAX_CONTEXT_MESSAGES - 1) as ChatMessageRow[];

    const history = [...recentMessages.reverse(), userMsg];

    // Prepend the system prompt to the first user message so it works
    // across all providers (Anthropic API doesn't accept role: 'system')
    const chatHistory = history.map((m, i) => {
      if (i === 0 && m.role === 'user') {
        return {
          role: 'user' as const,
          content: `${SYSTEM_PROMPT}\n\nStudent's question: ${m.content}`,
        };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });

    const responseText = await provider.complete({
      messages: chatHistory,
      maxTokens: 1024,
      task: 'chat',
    });
    entitlements.recordUsage(userId, 'llmRequestsPerMonth', 1);

    const assistantMsg: ChatMessageRow = {
      id: randomUUID(),
      role: 'assistant',
      content: responseText,
      provider: provider.name,
      responseId: null,
      createdAt: new Date().toISOString(),
      language: lang
    };

    // Save both messages only after LLM succeeds
    const insertMsg = db.prepare(
      'INSERT INTO chat_messages (id, role, content, provider, responseId, createdAt, language, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    insertMsg.run(
      userMsg.id, userMsg.role, userMsg.content, userMsg.provider,
      userMsg.responseId, userMsg.createdAt, lang, userId
    );
    insertMsg.run(
      assistantMsg.id, assistantMsg.role, assistantMsg.content, assistantMsg.provider,
      assistantMsg.responseId, assistantMsg.createdAt, lang, userId
    );

    return c.json({ userMessage: userMsg, assistantMessage: assistantMsg });
  } catch (error) {
    console.error('Chat error:', error);
    return c.json({ error: 'Failed to get response' }, 500);
  }
});

// DELETE /api/chat — clear chat history for the active (or requested) language
app.delete('/', (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  db.prepare('DELETE FROM chat_messages WHERE userId = ? AND language = ?').run(userId, lang);
  return c.json({ ok: true });
});

export default app;
