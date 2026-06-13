import { Hono } from 'hono';
import { db, ChatMessageRow } from '../db';
import { getProvider } from '../lib/llm';
import { LMStudioProvider, LMStudioInvalidResponseIdError } from '../lib/llm/lmstudio';
import { resolveLanguage } from '../lib/active-language';
import { getLanguageConfig, LanguageCode } from '../lib/languages';
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

  const limit = parseInt(c.req.query('limit') || '50');
  const before = c.req.query('before'); // cursor for infinite scroll
  const lang = resolveLanguage(c.req.query('lang'));

  let messages: ChatMessageRow[];

  if (before) {
    messages = db
      .prepare('SELECT * FROM chat_messages WHERE createdAt < ? AND language = ? ORDER BY createdAt DESC LIMIT ?')
      .all(before, lang, limit) as ChatMessageRow[];
  } else {
    messages = db
      .prepare('SELECT * FROM chat_messages WHERE language = ? ORDER BY createdAt DESC LIMIT ?')
      .all(lang, limit) as ChatMessageRow[];
  }

  return c.json(messages.reverse());
});

// POST /api/chat — send a message, get assistant response
app.post('/', async (c) => {
  try {
    cleanExpired();

    const { message, language } = await c.req.json();

    if (!message?.trim()) {
      return c.json({ error: 'message is required' }, 400);
    }

    const lang = resolveLanguage(language);
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
    let responseText: string;
    let newResponseId: string | null = null;

    if (provider instanceof LMStudioProvider) {
      // Stateful path: LM Studio holds the conversation; we just thread the latest response_id.
      const latestAssistant = db
        .prepare(
          "SELECT * FROM chat_messages WHERE role = 'assistant' AND responseId IS NOT NULL AND language = ? ORDER BY createdAt DESC LIMIT 1"
        )
        .get(lang) as ChatMessageRow | undefined;
      const previousResponseId = latestAssistant?.responseId || undefined;

      try {
        // Send system_prompt only on the first turn. LM Studio retains it on
        // the thread, and re-sending on every continuation muddies context
        // (we observed the model occasionally hallucinating when it was repeated).
        const result = await provider.chatStateful({
          input: userMsg.content,
          systemPrompt: previousResponseId ? undefined : SYSTEM_PROMPT,
          previousResponseId,
        });
        responseText = result.content;
        newResponseId = result.responseId || null;
      } catch (err) {
        if (err instanceof LMStudioInvalidResponseIdError) {
          // Fall back: replay the whole conversation through stateless complete().
          // Happens when the LM Studio server restarted or the response_id expired.
          const fallback = await runStatelessFallback(provider, lang, userMsg, SYSTEM_PROMPT);
          responseText = fallback;
        } else {
          throw err;
        }
      }
    } else {
      // Existing path for all other providers: send the full message history.
      const recentMessages = db
        .prepare('SELECT * FROM chat_messages WHERE language = ? ORDER BY createdAt DESC LIMIT ?')
        .all(lang, MAX_CONTEXT_MESSAGES - 1) as ChatMessageRow[];

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

      responseText = await provider.complete({
        messages: chatHistory,
        maxTokens: 1024,
      });
    }

    const assistantMsg: ChatMessageRow = {
      id: randomUUID(),
      role: 'assistant',
      content: responseText,
      provider: provider.name,
      responseId: newResponseId,
      createdAt: new Date().toISOString(),
      language: lang
    };

    // Save both messages only after LLM succeeds
    const insertMsg = db.prepare(
      'INSERT INTO chat_messages (id, role, content, provider, responseId, createdAt, language) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    insertMsg.run(
      userMsg.id, userMsg.role, userMsg.content, userMsg.provider,
      userMsg.responseId, userMsg.createdAt, lang
    );
    insertMsg.run(
      assistantMsg.id, assistantMsg.role, assistantMsg.content, assistantMsg.provider,
      assistantMsg.responseId, assistantMsg.createdAt, lang
    );

    return c.json({ userMessage: userMsg, assistantMessage: assistantMsg });
  } catch (error) {
    console.error('Chat error:', error);
    return c.json({ error: 'Failed to get response' }, 500);
  }
});

// DELETE /api/chat — clear chat history for the active (or requested) language
app.delete('/', (c) => {
  const lang = resolveLanguage(c.req.query('lang'));
  db.prepare('DELETE FROM chat_messages WHERE language = ?').run(lang);
  return c.json({ ok: true });
});

async function runStatelessFallback(
  provider: LMStudioProvider,
  lang: LanguageCode,
  userMsg: ChatMessageRow,
  systemPrompt: string,
): Promise<string> {
  const recentMessages = db
    .prepare('SELECT * FROM chat_messages WHERE language = ? ORDER BY createdAt DESC LIMIT ?')
    .all(lang, MAX_CONTEXT_MESSAGES - 1) as ChatMessageRow[];

  const history = [...recentMessages.reverse(), userMsg];
  const chatHistory = history.map((m, i) => {
    if (i === 0 && m.role === 'user') {
      return {
        role: 'user' as const,
        content: `${systemPrompt}\n\nStudent's question: ${m.content}`,
      };
    }
    return { role: m.role as 'user' | 'assistant', content: m.content };
  });

  return provider.complete({ messages: chatHistory, maxTokens: 1024 });
}

export default app;
