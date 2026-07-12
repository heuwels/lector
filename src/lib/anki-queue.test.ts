import { describe, expect, it, vi, beforeEach } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('./api-base', () => ({ apiFetch }));

import { queueForAnki, QUEUE_BATCH_LIMIT, type AnkiQueueItem } from './anki-queue';

// The server rejects queue batches above MAX_QUEUE_ITEMS (500); the client
// must chunk transparently or a large bulk export 400s (#241 review P1 #1).

function items(n: number): AnkiQueueItem[] {
  return Array.from({ length: n }, (_, i) => ({ id: `v${i}`, cardType: 'basic' as const }));
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe('queueForAnki chunking', () => {
  it('splits batches at the server ceiling and merges results', async () => {
    const sizes: number[] = [];
    apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      const sent = JSON.parse(init?.body as string) as { items: unknown[] };
      sizes.push(sent.items.length);
      return okResponse({
        queued: sent.items.length - 1,
        failed: [{ id: 'x', error: 'nope' }],
      });
    });

    const result = await queueForAnki(items(QUEUE_BATCH_LIMIT * 2 + 201));

    expect(sizes).toEqual([QUEUE_BATCH_LIMIT, QUEUE_BATCH_LIMIT, 201]);
    expect(result.queued).toBe(QUEUE_BATCH_LIMIT * 2 + 201 - 3);
    expect(result.failed).toHaveLength(3);
  });

  it('sends a single call for small batches', async () => {
    apiFetch.mockResolvedValue(okResponse({ queued: 2, failed: [] }));
    const result = await queueForAnki(items(2));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ queued: 2, failed: [] });
  });

  it('throws with the server message when a chunk is rejected', async () => {
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'boom' }), { status: 400 }),
    );
    await expect(queueForAnki(items(1))).rejects.toThrow('boom');
  });
});
