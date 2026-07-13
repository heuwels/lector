import './test-guard';
import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';

// ── Ratchet: keep per-language data partitioned ──────────────────────────────
// Every row in these tables carries a `language` (knownWords / dailyStats /
// cached_* use a compound (…, language) key). Any query that reads or writes one
// of them must EITHER scope by `language`, OR scope to a single row by its
// globally-unique `id` / a parent `…Id`, OR be listed in ALLOWLIST as a
// deliberate cross-language access. A new query that forgets `language` fails
// this test — fix the query, or add it to ALLOWLIST with a reason.
//
// This guards the regression class behind #189 (mislabelled / lost rows, leaked
// cross-language lists) and stands in for the never-built "ratchet ALLOWLIST"
// that issue referenced: the ALLOWLIST below IS that list, already down to only
// the sanctioned entries. Migrations (api/src/db.ts) legitimately rebuild tables
// without a language filter, so they are out of scope here.

const PARTITIONED = [
  'collections',
  'lessons',
  'vocab',
  'clozeSentences',
  'journal_entries',
  'chat_messages',
  'knownWords',
  'dailyStats',
  'cached_entries',
  'cached_senses',
  'cached_related_forms',
];

// Deliberate cross-language statements, matched by a distinctive substring within
// the named file. Consulted ONLY for a statement that already failed the language
// + by-id checks, so the match just has to disambiguate among those.
// `transient: true` marks an entry expected to disappear once related in-flight
// work lands — it's exempt from the stale-entry check so concurrent branches
// don't trip each other.
const ALLOWLIST: { file: string; match: string; why: string; transient?: boolean }[] = [
  // Admin dashboard (#221): service-wide aggregates that intentionally span
  // every language — per-user storage (lesson-text bytes) and last-active day.
  {
    file: 'routes/admin.ts',
    match: 'SUM(LENGTH(textContent))',
    why: 'admin: per-user storage across languages',
  },
  {
    file: 'routes/admin.ts',
    match: 'MAX(date) AS d FROM dailyStats',
    why: 'admin: last-active across languages',
  },
  // One streak across all languages (CLAUDE.md / issue #108): aggregates every day row.
  {
    file: 'routes/stats.ts',
    match: 'dictionaryLookups, clozePracticed, minutesRead, ankiReviews',
    why: 'app-wide streak',
  },
  // The heatmap must agree with that app-wide streak (#238): same unscoped stance,
  // summed per date across languages.
  {
    file: 'routes/stats.ts',
    match: 'SUM(dictionaryLookups) as dictionaryLookups',
    why: 'app-wide activity heatmap',
  },
  // "Did you study today" is app-wide (Sphere Guardian MCP): sums every language for the date.
  {
    file: 'routes/study-ping.ts',
    match: 'COALESCE(SUM(dictionaryLookups)',
    why: 'app-wide study-today aggregate',
  },
  // Chat history TTL cleanup is age-based, not language-based — expires old rows of any language.
  {
    file: 'routes/chat.ts',
    match: 'DELETE FROM chat_messages WHERE createdAt',
    why: 'age-based TTL cleanup',
  },
  // The bundled sentence bank is single-language; the seed dedup reconciles within
  // it. Per-language scoping rides with the in-flight cloze-bank rework.
  {
    file: 'routes/cloze.ts',
    match: 'WHERE tatoebaSentenceId IS NOT NULL',
    why: 'single-language seed dedup',
    transient: true,
  },
  {
    file: 'routes/cloze.ts',
    match: 'id IN (${placeholders})',
    why: 'storage preflight for per-tenant ids before the matching composite-key upsert',
  },
];

const SRC = import.meta.dir; // api/src

function scannedFiles(): string[] {
  const routes = fs
    .readdirSync(path.join(SRC, 'routes'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => `routes/${f}`);
  return [...routes, 'lib/dictionary-db.ts', 'lib/study-session.ts', 'lib/user-export.ts'];
}

// Strip comments first so backticks/apostrophes inside them can't break literal
// pairing (SQL strings never contain `//`, so this can't corrupt a query; the
// `[^:]` guard keeps `://` in URL strings intact).
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/([^:])\/\/[^\n]*/g, '$1');
}

// Pull SQL string literals (backtick templates + single-quoted) out of source.
function sqlLiterals(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  for (const m of code.matchAll(/`([^`]*)`/g)) out.push(m[1]);
  for (const m of code.matchAll(/'((?:[^'\\]|\\.)*)'/g)) out.push(m[1]);
  return out;
}

const TABLE_VERB = new RegExp(`\\b(?:INTO|FROM|UPDATE)\\s+(?:${PARTITIONED.join('|')})\\b`, 'i');
const SQL_KEYWORD = /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i;

function isByIdScoped(sql: string): boolean {
  // A globally-unique id (collections/lessons/vocab/cloze/journal/chat .id) or a
  // parent …Id (collectionId, groupId) pins the affected rows without language.
  // `userId` is deliberately excluded: it's the tenant axis (#217), not a
  // row-pinning id — a query scoped only by userId still spans languages.
  return /\bid\s*=\s*\?/i.test(sql) || /\b(?!userId\b)[A-Za-z]+Id\s*=\s*\?/.test(sql);
}

const usedAllowlist = new Set<number>();
const violations: { file: string; sql: string }[] = [];

for (const rel of scannedFiles()) {
  const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
  for (const sql of sqlLiterals(src)) {
    if (!SQL_KEYWORD.test(sql) || !TABLE_VERB.test(sql)) continue;
    if (/\blanguage\b/.test(sql)) continue; // language-scoped — good
    if (isByIdScoped(sql)) continue; // single-row / parent-id scoped — safe
    const ai = ALLOWLIST.findIndex((a) => rel.endsWith(a.file) && sql.includes(a.match));
    if (ai >= 0) {
      usedAllowlist.add(ai);
      continue;
    }
    violations.push({ file: rel, sql: sql.replace(/\s+/g, ' ').trim().slice(0, 140) });
  }
}

describe('language-partitioning ratchet', () => {
  test('no unsanctioned cross-language queries on partitioned tables', () => {
    expect(violations).toEqual([]);
  });

  test('every non-transient ALLOWLIST entry still matches a live statement', () => {
    const stale = ALLOWLIST.map((a, i) => ({ a, i }))
      .filter(({ a, i }) => !a.transient && !usedAllowlist.has(i))
      .map(({ a }) => `${a.file} :: ${a.match}`);
    expect(stale).toEqual([]);
  });
});
