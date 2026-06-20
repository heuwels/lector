import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// ── In-memory DB wiring (mirrors the journal route test) ────────────────────

let sqlite: InstanceType<typeof Database>;

vi.mock('@/lib/server/database', () => ({
  get db() {
    return sqlite;
  },
}));

import { GET } from '@/app/api/stats/fluency/route';

interface DomainAxis {
  domain: string;
  label: string;
  knownCount: number;
  masteryScore: number;
  axisValue: number;
  band: string;
}
interface FluencyResponse {
  totalKnownWords: number;
  byDomain: DomainAxis[];
  pending: number;
}

function createTables() {
  sqlite.exec(`
    CREATE TABLE knownWords (
      word TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'af',
      state TEXT NOT NULL,
      domain TEXT,
      PRIMARY KEY (word, language)
    );
    CREATE TABLE vocab (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'af',
      sentence TEXT NOT NULL DEFAULT '',
      translation TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE dailyStats (
      date TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'af',
      wordsMarkedKnown INTEGER DEFAULT 0,
      PRIMARY KEY (date, language)
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
}

function known(word: string, state: string, domain: string | null, language = 'af') {
  sqlite
    .prepare('INSERT INTO knownWords (word, language, state, domain) VALUES (?, ?, ?, ?)')
    .run(word, language, state, domain);
}

let vid = 0;
function vocab(text: string, language = 'af') {
  sqlite.prepare('INSERT INTO vocab (id, text, language) VALUES (?, ?, ?)').run(`v${vid++}`, text, language);
}

function makeRequest(url: string) {
  return new Request(`http://localhost${url}`) as unknown as import('next/server').NextRequest;
}

async function getFluency(language = 'af'): Promise<FluencyResponse> {
  const res = await GET(makeRequest(`/api/stats/fluency?language=${language}`));
  return (await res.json()) as FluencyResponse;
}

function axis(r: FluencyResponse, key: string): DomainAxis {
  const a = r.byDomain.find((d) => d.domain === key);
  if (!a) throw new Error(`expected a '${key}' axis in byDomain`);
  return a;
}

function countKnown(sql: string): number {
  return (sqlite.prepare(sql).get() as { c: number }).c;
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  createTables();
});

afterEach(() => {
  sqlite.close();
});

describe('GET /api/stats/fluency — byDomain + pending', () => {
  it('aggregates per domain, excludes general, counts unique words once, and reconciles with global known', async () => {
    // food (3 known) — 'kos' has TWO vocab encounters but ONE knownWords row.
    known('koffie', 'known', 'food');
    known('tee', 'known', 'food');
    known('kos', 'known', 'food');
    vocab('kos');
    vocab('kos');
    // health: one known + one mid-mastery (level2 contributes to mastery, not knownCount)
    known('longontsteking', 'known', 'health');
    known('dokter', 'level2', 'health');
    // science_tech
    known('rekenaar', 'known', 'science_tech');
    // general — classified, but never a radar axis
    known('die', 'known', 'general');
    // pending — mastery-state words the worker hasn't classified yet
    known('onbekend1', 'known', null);
    known('onbekend2', 'level3', null);
    // 'new' is NOT pending (the worker skips new/ignored)
    known('splinternuut', 'new', null);
    // a different language must be excluded from the 'af' radar
    known('apple', 'known', 'food', 'nl');

    const res = await getFluency('af');

    expect(res.byDomain).toHaveLength(10); // fixed taxonomy → stable axes
    expect(res.byDomain.some((d) => d.domain === 'general')).toBe(false);

    expect(axis(res, 'food').knownCount).toBe(3); // 'kos' counted once despite 2 vocab rows
    expect(axis(res, 'health').knownCount).toBe(1);
    expect(axis(res, 'health').masteryScore).toBeCloseTo(1.15); // 1 known + 0.15 level2
    expect(axis(res, 'science_tech').knownCount).toBe(1);

    const nature = axis(res, 'nature');
    expect(nature.knownCount).toBe(0);
    expect(nature.axisValue).toBe(0);
    expect(nature.band).toBe('Novice');

    // pending = mastery-state rows with domain IS NULL (known + level3), excludes 'new'
    expect(res.pending).toBe(2);

    // Reconciliation invariant: every KNOWN word lands in exactly one of
    // {a domain axis, general, still-pending} — none dropped, none double-counted.
    const sumDomainKnown = res.byDomain.reduce((s, d) => s + d.knownCount, 0);
    const generalKnown = countKnown("SELECT COUNT(*) c FROM knownWords WHERE language='af' AND domain='general' AND state='known'");
    const knownPending = countKnown("SELECT COUNT(*) c FROM knownWords WHERE language='af' AND domain IS NULL AND state='known'");
    expect(sumDomainKnown + generalKnown + knownPending).toBe(res.totalKnownWords);
    expect(res.totalKnownWords).toBe(7);
  });

  it('returns an all-zero radar (but non-zero pending) before anything is classified', async () => {
    known('koffie', 'known', null);
    known('tee', 'level1', null);

    const res = await getFluency('af');

    expect(res.byDomain).toHaveLength(10);
    expect(res.byDomain.every((d) => d.axisValue === 0 && d.knownCount === 0)).toBe(true);
    expect(res.pending).toBe(2); // both mastery-state + unclassified
  });
});
