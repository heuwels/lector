'use client';

import { MessageCircle, X, SendHorizonal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useActiveLanguage } from '@/utils/hooks';
import { apiFetch } from '@/lib/api-base';
import { useState, useEffect, useRef, useCallback } from 'react';
import { EXAMPLE_PROMPTS } from './constants';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  provider: string | null;
  createdAt: string;
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initialLoadDone = useRef(false);
  const activeLang = useActiveLanguage();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/chat?limit=50&language=${activeLang.code}`);
      const data = await res.json();
      setMessages(data);
      setHasMore(data.length === 50);
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  }, [activeLang]);

  // Load messages when opened
  useEffect(() => {
    if (isOpen && !initialLoadDone.current) {
      initialLoadDone.current = true;
      fetchMessages();
    }
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, fetchMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (isOpen && messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, isOpen, scrollToBottom]);

  async function loadMore() {
    if (loadingHistory || !hasMore || messages.length === 0) return;
    setLoadingHistory(true);

    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;

    try {
      const oldest = messages[0];
      const res = await apiFetch(
        `/api/chat?limit=50&before=${encodeURIComponent(oldest.createdAt)}&language=${activeLang.code}`,
      );
      const older = await res.json();
      if (older.length === 0) {
        setHasMore(false);
      } else {
        setMessages((prev) => [...older, ...prev]);
        setHasMore(older.length === 50);
        // Maintain scroll position after prepending
        requestAnimationFrame(() => {
          if (container) {
            container.scrollTop = container.scrollHeight - prevScrollHeight;
          }
        });
      }
    } catch (err) {
      console.error('Failed to load more messages:', err);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function sendMessage(text?: string) {
    const content = (text || input).trim();
    if (!content || loading) return;

    setInput('');
    setLoading(true);

    // Optimistic user message
    const tempUserMsg: ChatMessage = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content,
      provider: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, language: activeLang.code }),
      });

      if (!res.ok) throw new Error('Failed to send message');

      const { userMessage, assistantMessage } = await res.json();

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserMsg.id),
        userMessage,
        assistantMessage,
      ]);
    } catch (err) {
      console.error('Chat error:', err);
      // Replace optimistic message with error feedback
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserMsg.id),
        { ...tempUserMsg, id: 'user-' + Date.now() },
        {
          id: 'error-' + Date.now(),
          role: 'assistant' as const,
          content:
            "Sorry, I couldn't respond. Check that an LLM provider is configured in Settings.",
          provider: null,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // Re-focus the input once loading drops back to false. Calling .focus() in the
  // sendMessage finally block fires before React re-renders the (disabled) textarea,
  // so the focus is a no-op. Doing it via an effect runs after the DOM update.
  useEffect(() => {
    if (isOpen && !loading) {
      inputRef.current?.focus();
    }
  }, [loading, isOpen]);

  async function clearChat() {
    try {
      await apiFetch(`/api/chat?language=${activeLang.code}`, { method: 'DELETE' });
      setMessages([]);
      setHasMore(false);
    } catch (err) {
      console.error('Failed to clear chat:', err);
    }
  }

  function handleScroll() {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (container.scrollTop < 80 && hasMore && !loadingHistory) {
      loadMore();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const toggleOpen = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      {/* Floating trigger button */}
      <Button
        onClick={toggleOpen}
        className="fixed right-4 bottom-20 z-50 flex h-12 w-12 rounded-full shadow-lg transition-all hover:shadow-xl sm:right-6 sm:bottom-6 print:hidden"
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
        data-testid="chat-toggle"
      >
        {isOpen ? <X /> : <MessageCircle />}
      </Button>

      {/* Chat panel */}
      {isOpen && (
        <div
          className="fixed right-4 bottom-36 z-50 flex h-[80vh] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl sm:right-6 sm:bottom-20 sm:w-96 print:hidden"
          data-testid="chat-panel"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-muted px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {activeLang.name} Tutor
              </h3>
              <p className="text-xs text-muted-foreground">
                Ask anything about {activeLang.name}
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={clearChat}
              className="text-xs text-muted-foreground transition-colors hover:text-destructive"
              title="Clear chat"
              data-testid="chat-clear"
            >
              Clear
            </Button>
          </div>

          {/* Messages */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
            data-testid="chat-messages"
          >
            {loadingHistory && (
              <div className="py-2 text-center text-xs text-muted-foreground">
                Loading older messages...
              </div>
            )}

            {messages.length === 0 && !loading && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="mb-4 text-sm text-muted-foreground">
                  Ask a question about {activeLang.name}
                </p>
                <div className="w-full space-y-2">
                  {EXAMPLE_PROMPTS[activeLang.code].map((prompt) => (
                    <Button
                      variant="ghost"
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      className="block h-auto w-full cursor-pointer rounded-lg bg-muted px-3 py-2 text-left text-xs whitespace-normal text-muted-foreground transition-colors hover:bg-[var(--primary-soft)] hover:text-primary"
                      data-testid="chat-example-prompt"
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  <div className="break-words whitespace-pre-wrap">{msg.content}</div>
                  {msg.role === 'assistant' && msg.provider && (
                    <div className="mt-1 text-[10px] opacity-50" data-testid="chat-provider-label">
                      via {msg.provider}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce" style={{ animationDelay: '0ms' }}>
                      .
                    </span>
                    <span className="animate-bounce" style={{ animationDelay: '150ms' }}>
                      .
                    </span>
                    <span className="animate-bounce" style={{ animationDelay: '300ms' }}>
                      .
                    </span>
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border px-3 py-2">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask about ${activeLang.native}...`}
                rows={1}
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
                disabled={loading}
                data-testid="chat-input"
              />
              <Button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="chat-send"
              >
                <SendHorizonal className="-rotate-90" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
