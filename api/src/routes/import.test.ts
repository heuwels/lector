import '../test-guard';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { db } from '../db';
import { makeEntitlements, parsePlanLimitOverrides, type PlanLimits } from '../lib/entitlements';
import type { ParsedEpub } from '../lib/epub-parser';
import { makeImportRoutes } from './import';

function strictEngine(overrides: Partial<PlanLimits>) {
  const defaults = parsePlanLimitOverrides(undefined);
  return makeEntitlements({
    enforced: true,
    freeTierEnabled: true,
    exemptEmails: new Set(),
    prices: [],
    planLimits: {
      ...defaults,
      free: { ...defaults.free, ...overrides },
    },
    resolveEmail: () => null,
    isByok: () => false,
    compedPlan: () => null,
    now: () => new Date('2026-07-15T12:00:00Z'),
  });
}

function upload(): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([1, 2, 3])], 'book.epub'));
  form.append('language', 'es');
  return form;
}

function parsed(chapters = 2): ParsedEpub {
  return {
    title: 'Test book',
    author: 'Test author',
    chapters: Array.from({ length: chapters }, (_, index) => ({
      title: `Chapter ${index + 1}`,
      markdown: `Chapter body number ${index + 1}`,
      wordCount: 4,
    })),
  };
}

function localCount(table: 'collections' | 'lessons'): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE userId = 'local'`).get() as {
      n: number;
    }
  ).n;
}

beforeEach(() => {
  db.prepare("DELETE FROM lessons WHERE userId = 'local'").run();
  db.prepare("DELETE FROM collections WHERE userId = 'local'").run();
  db.prepare("DELETE FROM billing_subscriptions WHERE userId = 'local'").run();
});

afterEach(() => {
  db.prepare("DELETE FROM lessons WHERE userId = 'local'").run();
  db.prepare("DELETE FROM collections WHERE userId = 'local'").run();
});

describe('EPUB import plan limits', () => {
  test('rejects a full collection library before parsing/decompression', async () => {
    let parseCalls = 0;
    const app = makeImportRoutes({
      engine: strictEngine({ maxCollections: 0 }),
      parse() {
        parseCalls += 1;
        throw new Error('must not parse');
      },
    });

    const response = await app.request('/epub', { method: 'POST', body: upload() });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: 'plan_limit',
      metric: 'maxCollections',
      requested: 1,
    });
    expect(parseCalls).toBe(0);
    expect(localCount('collections')).toBe(0);
  });

  test('retains the final atomic chapter-count reservation after parsing', async () => {
    let parseCalls = 0;
    const app = makeImportRoutes({
      engine: strictEngine({ maxCollections: 10, maxLessons: 1 }),
      parse() {
        parseCalls += 1;
        return parsed(2);
      },
    });

    const response = await app.request('/epub', { method: 'POST', body: upload() });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: 'plan_limit',
      metric: 'maxLessons',
      requested: 2,
    });
    expect(parseCalls).toBe(1);
    expect(localCount('collections')).toBe(0);
    expect(localCount('lessons')).toBe(0);
  });

  test('checks UTF-8 lesson bytes in the same final reservation', async () => {
    const app = makeImportRoutes({
      engine: strictEngine({
        maxCollections: 10,
        maxLessons: 10,
        maxLessonTextBytes: 4,
      }),
      parse: () => ({
        title: 'Book',
        author: 'Author',
        chapters: [{ title: 'A', markdown: 'éé', wordCount: 1 }],
      }),
    });

    const response = await app.request('/epub', { method: 'POST', body: upload() });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: 'plan_limit',
      metric: 'maxLessonTextBytes',
      requested: 5,
    });
    expect(localCount('collections')).toBe(0);
    expect(localCount('lessons')).toBe(0);
  });
});

describe('EPUB import request and parser boundaries', () => {
  const engine = () =>
    strictEngine({
      maxCollections: 10,
      maxLessons: 10,
      maxLessonTextBytes: 10_000,
      maxLessonTextBytesTotal: 100_000,
      maxCollectionMetadataBytes: 10_000,
    });

  test('rejects a missing file before invoking the parser', async () => {
    let parseCalls = 0;
    const app = makeImportRoutes({
      engine: engine(),
      parse() {
        parseCalls += 1;
        return parsed();
      },
    });
    const form = new FormData();
    form.append('language', 'af');

    const response = await app.request('/epub', { method: 'POST', body: form });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'File required' });
    expect(parseCalls).toBe(0);
  });

  test('maps malformed multipart input to a route-level 400 without parsing', async () => {
    let parseCalls = 0;
    const app = makeImportRoutes({
      engine: engine(),
      parse() {
        parseCalls += 1;
        return parsed();
      },
    });

    const response = await app.request('/epub', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=expected-boundary' },
      body: '--different-boundary--',
    });

    expect(response.status).toBe(400);
    expect(parseCalls).toBe(0);
    expect(localCount('collections')).toBe(0);
  });

  test('rejects an oversized upload from Content-Length before parsing', async () => {
    let parseCalls = 0;
    const app = makeImportRoutes({
      engine: engine(),
      parse() {
        parseCalls += 1;
        return parsed();
      },
    });

    const response = await app.request('/epub', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(50 * 1024 * 1024 + 1),
      },
      body: 'small test body',
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'EPUB is too large (max 50 MB).' });
    expect(parseCalls).toBe(0);
  });

  test('returns a parser failure without leaving collection or lesson rows', async () => {
    const app = makeImportRoutes({
      engine: engine(),
      parse() {
        throw new Error('invalid central directory');
      },
    });

    const response = await app.request('/epub', { method: 'POST', body: upload() });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Failed to parse EPUB file' });
    expect(localCount('collections')).toBe(0);
    expect(localCount('lessons')).toBe(0);
  });

  test('rolls back the collection when a chapter insert fails', async () => {
    const app = makeImportRoutes({
      engine: engine(),
      parse: () => ({
        title: 'Rollback book',
        author: 'Test author',
        chapters: [
          {
            title: null as unknown as string,
            markdown: 'Valid body',
            wordCount: 2,
          },
        ],
      }),
    });

    const response = await app.request('/epub', { method: 'POST', body: upload() });

    expect(response.status).toBe(400);
    expect(localCount('collections')).toBe(0);
    expect(localCount('lessons')).toBe(0);
  });
});
